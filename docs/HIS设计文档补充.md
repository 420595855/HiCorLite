# HIS 系统设计文档 — 补充与完善

> 本文档是对原设计文档的系统性补充，涵盖**缺失模块、架构设计、API规范、安全加固、性能优化**等方面。

---

# 十五、技术架构设计

---

## 15.1 整体技术架构

### 技术选型

| 层级 | 技术方案 | 说明 |
|---|---|---|
| 前端 | Vue 3 + Element Plus / Ant Design Vue | 后台管理；React Native / Flutter 用于移动端 |
| API网关 | Spring Cloud Gateway | 统一入口、限流、鉴权、灰度路由 |
| 注册中心 | Nacos | 服务注册发现 + 配置中心 |
| 服务框架 | Spring Boot 3 + Spring Cloud 2023 | 微服务基座 |
| ORM | MyBatis-Plus | 多租户拦截器、分页插件 |
| 缓存 | Redis Cluster | 会话、热点数据、分布式锁 |
| 消息队列 | RocketMQ / RabbitMQ | 异步解耦、削峰填谷 |
| 搜索引擎 | Elasticsearch | 病历全文检索、日志检索 |
| 任务调度 | XXL-JOB | 定时任务（报表统计、数据归档） |
| 文件存储 | MinIO / 阿里云OSS | 影像文件、附件、病历文档 |
| 数据库 | MySQL 8.0 (主从) + TiDB (可选) | OLTP；ClickHouse 用于OLAP |
| 容器化 | Docker + Kubernetes | 微服务编排、弹性伸缩 |
| CI/CD | Jenkins / GitLab CI | 自动化构建、部署流水线 |
| 监控 | Prometheus + Grafana + SkyWalking | 指标监控 + 链路追踪 + 日志 |

### 微服务拆分

```
open-his/
├── his-gateway                # API网关
├── his-auth                   # 认证授权服务
├── his-system                 # 系统管理（组织/用户/字典/配置）
├── his-outpatient             # 门急诊业务服务
├── his-inpatient              # 住院业务服务
├── his-emr                    # 电子病历服务
├── his-pharmacy               # 药品管理服务
├── his-fee                    # 收费与财务服务
├── his-lis                    # 检验管理服务
├── his-pacs                   # 影像管理服务
├── his-surgery                # 手术麻醉服务
├── his-insurance              # 医保服务
├── his-public-health          # 公卫上报服务
├── his-internet               # 互联网医院服务
├── his-cdss                   # 临床决策支持服务
├── his-bi                     # BI与数据服务
├── his-integration            # 集成平台服务
├── his-message                # 消息中心服务
└── his-common                 # 公共模块（工具类/DTO/常量）
```

### 服务间通信

```
同步调用：OpenFeign（强依赖场景，如收费需查处方）
异步消息：RocketMQ（弱依赖场景，如发药后通知库存扣减）
事件驱动：领域事件（如患者入院事件 → 触发多个下游初始化）
```

---

## 15.2 统一接口规范

### 请求/响应格式

```java
// 统一响应体
public class Result<T> {
    private int code;           // 业务状态码
    private String message;     // 提示信息
    private T data;             // 响应数据
    private long timestamp;     // 时间戳
    private String traceId;     // 链路追踪ID
}

// 统一分页请求
public class PageRequest {
    @Min(1)
    private int pageNum = 1;
    @Max(500)
    private int pageSize = 20;
    private String sortBy;
    private String sortOrder;   // ASC/DESC
}

// 统一分页响应
public class PageResult<T> {
    private List<T> records;
    private long total;
    private int pageNum;
    private int pageSize;
    private int pages;
}
```

### 业务错误码设计

```
错误码格式：模块码 + 错误类型 + 序号（共6位）

模块码：
  10 - 系统管理
  20 - 门急诊
  30 - 住院
  40 - 电子病历
  50 - 药品
  60 - 收费财务
  70 - 医技
  80 - 医保

错误类型：
  0 - 成功
  1 - 参数校验错误
  2 - 业务规则错误
  3 - 数据不存在
  4 - 权限不足
  5 - 系统异常

示例：
  200101 - 门急诊-参数错误-号源不足
  300201 - 住院-业务错误-床位已占用
  500201 - 药品-业务错误-库存不足
```

```java
public enum ErrorCode {
    // 通用
    SUCCESS(0, "成功"),
    PARAM_ERROR(1001, "参数校验失败"),
    NOT_FOUND(1003, "数据不存在"),
    UNAUTHORIZED(1004, "未登录或会话已过期"),
    FORBIDDEN(1005, "无权限访问"),
    SYSTEM_ERROR(1006, "系统异常"),

    // 门急诊 20xxxx
    OP_NO_AVAILABLE_SOURCE(200101, "号源已满"),
    OP_APPOINTMENT_LIMITED(200102, "已达预约上限"),
    OP_ALREADY_REGISTERED(200103, "该患者今日已挂号"),
    OP_PRESCRIPTION_EXPIRED(200201, "处方已过期"),

    // 住院 30xxxx
    IP_BED_OCCUPIED(300201, "床位已被占用"),
    IP_DEPOSIT_INSUFFICIENT(300202, "预交金余额不足"),
    IP_ORDER_ALREADY_EXECUTED(300203, "医嘱已执行，不可修改"),

    // 药品 50xxxx
    DRUG_STOCK_INSUFFICIENT(500201, "药品库存不足"),
    DRUG_EXPIRED(500202, "药品已过期"),
    DRUG_SPECIAL_APPROVAL(500203, "特殊药品需审批"),
    ;
}
```

### API版本管理

```
URL格式：/api/v1/{module}/{resource}

版本策略：
  - 大版本号在URL路径中（v1, v2）
  - 小版本通过Header: X-API-Version: 1.1
  - 废弃接口标记 @Deprecated，保留至少2个版本周期
```

---

## 15.3 部署架构

### 生产环境拓扑

```
                    ┌─────────────┐
                    │   CDN/WAF   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   SLB/NGINX │  负载均衡
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼────┐ ┌────▼─────┐
        │ Gateway-1 │ │ GW-2   │ │  GW-N    │  API网关集群
        └─────┬─────┘ └───┬────┘ └────┬─────┘
              │            │            │
              └────────────┼────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼────┐ ┌────▼─────┐
        │ Service-1 │ │ Svc-2  │ │  Svc-N   │  业务服务集群(K8s)
        └─────┬─────┘ └───┬────┘ └────┬─────┘
              │            │            │
    ┌─────────┼────────────┼────────────┼─────────┐
    │         │            │            │         │
┌───▼───┐ ┌──▼───┐  ┌─────▼─────┐ ┌───▼───┐ ┌──▼────┐
│ MySQL │ │Redis │  │RocketMQ  │ │  ES   │ │ MinIO │
│Master │ │Cluster│  │ Cluster  │ │Cluster│ │Cluster│
│  ↓    │ └──────┘  └──────────┘ └───────┘ └───────┘
│ Slave │
└───────┘
```

### K8s部署要点

```yaml
# 业务服务Deployment示例
apiVersion: apps/v1
kind: Deployment
metadata:
  name: his-outpatient
  namespace: his
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: his-outpatient
  template:
    spec:
      containers:
        - name: his-outpatient
          image: registry.hospital.com/his-outpatient:latest
          resources:
            requests:
              cpu: "500m"
              memory: "512Mi"
            limits:
              cpu: "2000m"
              memory: "2Gi"
          livenessProbe:
            httpGet:
              path: /actuator/health/liveness
              port: 8080
            initialDelaySeconds: 60
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 5
```

---

## 15.4 数据架构

### 读写分离

```
写操作 → Master库
读操作 → Slave库（可配置强制读Master的场景，如写后立即读）

MyBatis-Plus + Dynamic DataSource 实现：
  @DS("master")  // 强制走主库
  @DS("slave")   // 走从库
```

### 数据归档策略

```
热数据（最近6个月）：主库，实时查询
温数据（6个月-2年）：从库/归档库，按需查询
冷数据（2年以上）：归档到对象存储/数据仓库，按需恢复

归档表清单：
  - op_visit / op_prescription / op_order → 门诊业务数据
  - ip_fee_detail / ip_order_exec → 住院业务数据
  - sys_operation_log / sys_login_log → 日志数据
  - integration_message_log → 集成消息日志
```

### 分库分表策略（大型医院）

```
当单表数据量超过5000万行时考虑分表：

分片键选择：
  - 门诊业务：patient_id（患者维度）
  - 住院业务：admission_id（住院维度）
  - 日志数据：create_time（时间维度）

分表数量：按年分表（如 ip_order_2025, ip_order_2026）

中间件：ShardingSphere-JDBC
```

### 缓存策略

```
一级缓存：JVM本地缓存（Caffeine）— 字典数据、系统配置
二级缓存：Redis Cluster — 会话、热点数据、分布式锁

缓存Key规范：
  his:session:{sessionId}           — 用户会话
  his:dict:{dictTypeCode}           — 字典数据
  his:source:lock:{deptId}:{date}   — 号源分布式锁
  his:bed:status:{deptId}           — 床位状态
  his:patient:info:{patientId}      — 患者基本信息
  his:drug:stock:{warehouseId}:{drugId} — 药品库存
```

---

# 十六、安全设计补充

---

## 16.1 数据加密方案

### 敏感字段加密

```
加密策略：AES-256-GCM 加密存储，查询时解密

敏感字段清单：
  - 身份证号（id_card）
  - 手机号（phone）
  - 银行卡号
  - 详细地址（address）
  - 过敏史、既往病史（医疗敏感信息）
```

```sql
-- 敏感字段统一使用 VARBINARY 存储
ALTER TABLE patient_master MODIFY id_card VARBINARY(256);
ALTER TABLE patient_master MODIFY phone VARBINARY(256);

-- 密钥管理表
CREATE TABLE sys_encryption_key (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    key_alias       VARCHAR(64) NOT NULL COMMENT '密钥别名',
    key_value       VARCHAR(512) NOT NULL COMMENT '加密后的密钥(由主密钥加密)',
    algorithm       VARCHAR(32) DEFAULT 'AES-256-GCM',
    status          TINYINT DEFAULT 1,
    expire_time     DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 数据脱敏规则

| 字段类型 | 脱敏规则 | 示例 |
|---|---|---|
| 身份证号 | 保留前3后4 | 110***1234 |
| 手机号 | 保留前3后4 | 138****5678 |
| 银行卡号 | 保留后4位 | ****5678 |
| 姓名 | 保留姓 | 张** |
| 地址 | 保留省市 | 北京市**** |

```java
@DataMask(type = MaskType.ID_CARD)
private String idCard;

@DataMask(type = MaskType.PHONE)
private String phone;
```

---

## 16.2 API安全

### 接口限流

```
限流策略（基于Sentinel/Redisson）：
  - 全局：1000 QPS
  - 单用户：100 次/分钟
  - 敏感接口（如密码重置）：5 次/分钟
  - 医保接口：按医保局要求（通常 50 QPS）
```

### 接口签名

```
签名算法（防篡改）：
  1. 将请求参数按字母排序拼接
  2. 拼接 timestamp + nonce + appSecret
  3. SHA-256 哈希

Header:
  X-App-Id: his-web
  X-Timestamp: 1700000000
  X-Nonce: a1b2c3d4
  X-Signature: sha256(sortedParams + timestamp + nonce + appSecret)
```

### 操作二次确认

```
高风险操作需二次确认（输入密码或短信验证码）：
  - 处方强制提交（合理用药拦截后）
  - 退费操作
  - 毒麻药品发放
  - 患者身份合并
  - 系统配置修改
  - 用户权限变更
```

---

# 十七、缺失核心模块

---

## 17.1 临床决策支持（CDSS）

### 功能详述

| 功能 | 说明 |
|---|---|
| 知识库管理 | 疾病知识库、诊疗指南、药品说明书、临床路径 |
| 诊断推荐 | 基于症状/体征/检验结果推荐可能诊断 |
| 治疗方案推荐 | 基于诊断推荐治疗方案（参考指南） |
| 检验解读 | 异常检验结果的临床意义解读 |
| 用药建议 | 基于诊断和患者情况的用药建议 |
| 临床规则引擎 | 可配置的临床规则（如：发热+白细胞高→提示感染） |
| 知识检索 | 医学知识全文检索 |
| 临床预警 | 基于多指标综合分析的预警（如脓毒症预警） |

### 数据模型

```sql
-- 临床知识库
CREATE TABLE cdss_knowledge (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    knowledge_type  VARCHAR(32) NOT NULL COMMENT 'DISEASE/DRUG/GUIDE/SYMPTOM/LAB',
    knowledge_code  VARCHAR(64) NOT NULL,
    title           VARCHAR(256) NOT NULL,
    content         TEXT NOT NULL,
    tags            JSON COMMENT '标签',
    source          VARCHAR(256) COMMENT '来源（指南名称/文献）',
    version         VARCHAR(32),
    effective_date  DATE,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_content (title, content)
);

-- 临床规则
CREATE TABLE cdss_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    rule_code       VARCHAR(64) NOT NULL,
    rule_name       VARCHAR(256) NOT NULL,
    rule_type       VARCHAR(32) NOT NULL COMMENT 'DIAGNOSIS/TREATMENT/ALERT/DRUG',
    condition_expr  TEXT NOT NULL COMMENT '条件表达式(JSON)',
    action_type     VARCHAR(32) NOT NULL COMMENT 'SUGGEST/WARN/BLOCK/ALERT',
    action_content  TEXT NOT NULL COMMENT '动作内容',
    priority        INT DEFAULT 0 COMMENT '优先级',
    evidence_level  VARCHAR(16) COMMENT '证据等级(A/B/C)',
    reference       VARCHAR(512) COMMENT '参考文献',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- CDSS触发记录
CREATE TABLE cdss_trigger_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    visit_id        BIGINT,
    admission_id    BIGINT,
    rule_id         BIGINT NOT NULL,
    trigger_scene   VARCHAR(32) COMMENT 'PRESCRIPTION/DIAGNOSIS/ORDER',
    trigger_data    JSON COMMENT '触发时的数据快照',
    result_type     VARCHAR(16) COMMENT 'SUGGEST/WARN/BLOCK',
    result_content  TEXT,
    doctor_action   VARCHAR(16) COMMENT 'ACCEPTED/OVERRIDDEN/IGNORED',
    doctor_reason   VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_patient (patient_id, create_time)
);
```

### 核心流程

```
医生开具处方/医嘱
    ↓
系统实时调用CDSS引擎
    ↓
规则匹配（症状+诊断+检验+药品 → 匹配规则库）
    ↓
┌─────────────┬──────────────┬──────────────┐
│   建议(SUGGEST) │ 警告(WARN)  │ 拦截(BLOCK)  │
│   弹窗展示建议  │ 需确认后继续│ 必须修改才能继续│
└─────────────┴──────────────┴──────────────┘
    ↓
医生处理（接受/忽略/修改）
    ↓
记录触发日志（用于后续效果评估）
```

---

## 17.2 院感管理

### 功能详述

| 功能 | 说明 |
|---|---|
| 感染病例监测 | 自动筛查疑似感染病例（基于检验/体温/用药数据） |
| 感染上报 | 确认感染后填报上报卡 |
| 环境监测 | 空气/物表/手卫生监测记录 |
| 消毒管理 | 消毒记录、消毒效果监测 |
| 抗菌药物监测 | 与抗菌药物管理模块联动 |
| 手卫生依从性 | 手卫生执行率统计 |
| 职业暴露 | 医务人员职业暴露登记、处理、随访 |
| 感染暴发预警 | 同一科室短期内多例同类感染自动预警 |
| 统计报表 | 感染率、感染部位分布、病原菌分布 |

### 数据模型

```sql
-- 院感病例
CREATE TABLE ni_case (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    case_no         VARCHAR(32) NOT NULL,
    patient_id      BIGINT NOT NULL,
    admission_id    BIGINT,
    patient_name    VARCHAR(64),
    dept_id         BIGINT NOT NULL,
    bed_no          VARCHAR(16),
    infection_site  VARCHAR(64) NOT NULL COMMENT '感染部位',
    infection_date  DATE NOT NULL,
    pathogen        VARCHAR(128) COMMENT '病原菌',
    infection_type  VARCHAR(32) COMMENT '医院感染/社区感染',
    risk_factors    JSON COMMENT '危险因素',
    diagnosis_basis VARCHAR(32) COMMENT '临床/实验室/影像',
    report_doctor_id BIGINT,
    report_time     DATETIME,
    status          VARCHAR(16) DEFAULT 'REPORTED' COMMENT 'REPORTED/CONFIRMED/CLOSED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_case_no (hospital_id, case_no)
);

-- 环境监测
CREATE TABLE ni_environment_monitor (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    monitor_type    VARCHAR(32) NOT NULL COMMENT 'AIR/SURFACE/HAND_WATER',
    monitor_location VARCHAR(128) NOT NULL,
    dept_id         BIGINT,
    monitor_date    DATE NOT NULL,
    sample_no       VARCHAR(32),
    test_item       VARCHAR(64),
    result_value    VARCHAR(64),
    standard_value  VARCHAR(64),
    is_qualified    TINYINT,
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 职业暴露
CREATE TABLE ni_occupational_exposure (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    exposure_no     VARCHAR(32) NOT NULL,
    staff_id        BIGINT NOT NULL COMMENT '暴露人员',
    staff_name      VARCHAR(64),
    exposure_type   VARCHAR(32) NOT NULL COMMENT 'NEEDLE_STICK/BLOOD_CONTACT/BODY_FLUID',
    exposure_time   DATETIME NOT NULL,
    exposure_site   VARCHAR(64),
    source_patient_id BIGINT COMMENT '暴露源患者',
    source_disease  VARCHAR(64) COMMENT '暴露源疾病(HBV/HCV/HIV等)',
    immediate_action TEXT COMMENT '紧急处理措施',
    followup_plan   JSON COMMENT '随访计划',
    followup_result TEXT COMMENT '随访结果',
    status          VARCHAR(16) DEFAULT 'REPORTED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_exposure_no (hospital_id, exposure_no)
);
```

### 自动筛查规则

```
疑似院感自动触发条件（示例）：
  1. 入院48小时后出现发热（>38.5℃）+ 白细胞升高
  2. 入院48小时后新出现的肺部感染影像学表现
  3. 术后切口分泌物培养阳性
  4. 导管相关血流感染：中心静脉置管48h后血培养阳性
  5. 泌尿道感染：留置导尿48h后尿培养阳性

触发后 → 生成疑似感染预警 → 院感科审核 → 确认/排除
```

---

## 17.3 体检管理

### 功能详述

| 功能 | 说明 |
|---|---|
| 体检套餐管理 | 套餐项目组合、定价、适用人群 |
| 团检管理 | 单位团检预约、名单导入、结算 |
| 个人体检 | 个人预约、现场登记 |
| 体检指引单 | 自动生成指引单（检查项目、地点、注意事项） |
| 结果录入 | 各科室录入体检结果 |
| 总检报告 | 总检医师审核、生成体检报告 |
| 异常追踪 | 异常结果的复查提醒和追踪 |
| 健康管理 | 健康评估、健康干预建议 |

### 数据模型

```sql
-- 体检套餐
CREATE TABLE pe_package (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    package_code    VARCHAR(32) NOT NULL,
    package_name    VARCHAR(128) NOT NULL,
    package_type    VARCHAR(16) COMMENT 'BASIC/COMPREHENSIVE/SPECIAL/GROUP',
    target_gender   VARCHAR(8) COMMENT '适用性别: ALL/MALE/FEMALE',
    min_age         INT,
    max_age         INT,
    base_price      DECIMAL(10,2),
    description     TEXT,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, package_code)
);

-- 套餐项目
CREATE TABLE pe_package_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    package_id      BIGINT NOT NULL,
    item_id         BIGINT NOT NULL COMMENT '收费项目ID',
    item_name       VARCHAR(256),
    item_group      VARCHAR(32) COMMENT '项目分组(一般检查/内科/外科/检验/影像)',
    is_optional     TINYINT DEFAULT 0 COMMENT '是否可选',
    sort_order      INT DEFAULT 0,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_package (package_id)
);

-- 体检登记
CREATE TABLE pe_register (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    register_no     VARCHAR(32) NOT NULL,
    patient_id      BIGINT,
    patient_name    VARCHAR(64) NOT NULL,
    gender          VARCHAR(8),
    age             INT,
    id_card         VARCHAR(32),
    phone           VARCHAR(16),
    company_name    VARCHAR(128) COMMENT '单位名称(团检)',
    group_id        BIGINT COMMENT '团检批次ID',
    package_id      BIGINT,
    register_date   DATE NOT NULL,
    exam_date       DATE,
    total_amount    DECIMAL(10,2),
    pay_status      VARCHAR(16) DEFAULT 'UNPAID',
    report_status   VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED',
    report_date     DATE,
    status          VARCHAR(16) DEFAULT 'REGISTERED' COMMENT 'REGISTERED/EXAMINING/COMPLETED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_register_no (hospital_id, register_no)
);

-- 体检结果
CREATE TABLE pe_result (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    register_id     BIGINT NOT NULL,
    item_id         BIGINT NOT NULL,
    item_name       VARCHAR(256),
    item_group      VARCHAR(32),
    result_value    VARCHAR(512),
    unit            VARCHAR(32),
    reference_range VARCHAR(64),
    abnormal_flag   VARCHAR(16) COMMENT 'NORMAL/ABNORMAL/CRITICAL',
    finding         TEXT COMMENT '所见描述(影像类)',
    diagnosis       VARCHAR(512) COMMENT '诊断结论(影像类)',
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    report_time     DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_register (register_id)
);
```

---

## 17.4 手术麻醉系统

### 功能详述

| 功能 | 说明 |
|---|---|
| 术前访视 | 麻醉医师术前评估（气道/心肺功能/ASA分级） |
| 麻醉方案 | 制定麻醉方式、用药方案 |
| 术中监护 | 实时采集生命体征（心电/血压/血氧/呼末CO2等） |
| 麻醉记录 | 自动生成麻醉记录单（用药、事件、生命体征曲线） |
| 用药管理 | 麻醉用药记录（诱导/维持/镇痛/肌松） |
| 术中事件 | 记录术中关键事件（出血/输血/用药变更等） |
| 复苏室管理 | PACU恢复记录、Steward评分 |
| 术后镇痛 | PCA泵管理、镇痛效果评估 |
| 麻醉评分 | ASA分级、Mallampati气道评分 |

### 数据模型

```sql
-- 麻醉记录
CREATE TABLE anesthesia_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    surgery_id      BIGINT NOT NULL COMMENT '手术申请ID',
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    asa_grade       VARCHAR(8) COMMENT 'ASA分级(I-V)',
    airway_assessment JSON COMMENT '气道评估',
    anesthesia_type VARCHAR(32) NOT NULL COMMENT '全麻/椎管内/神经阻滞/局麻',
    anesthesia_plan TEXT COMMENT '麻醉方案',
    anesthesiologist_id BIGINT NOT NULL,
    anesthesiologist_name VARCHAR(64),
    nurse_id        BIGINT COMMENT '麻醉护士',
    -- 时间节点
    anesthesia_start_time DATETIME COMMENT '麻醉开始',
    anesthesia_end_time DATETIME COMMENT '麻醉结束',
    intubation_time DATETIME COMMENT '插管时间',
    extubation_time DATETIME COMMENT '拔管时间',
    -- 术中数据
    vital_signs_timeline JSON COMMENT '生命体征时间线(采样数据)',
    medication_timeline JSON COMMENT '用药时间线',
    event_timeline  JSON COMMENT '事件时间线',
    fluid_balance   JSON COMMENT '出入量(输液/输血/出血/尿量)',
    -- 术后
    pacu_admit_time DATETIME,
    pacu_discharge_time DATETIME,
    steward_score   INT COMMENT 'Steward苏醒评分',
    postop_pain_score INT COMMENT '术后疼痛评分',
    complications   VARCHAR(512),
    status          VARCHAR(16) DEFAULT 'DRAFT',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_surgery (surgery_id),
    INDEX idx_admission (admission_id)
);

-- 生命体征采样（高频数据）
CREATE TABLE anesthesia_vital_signs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    record_id       BIGINT NOT NULL,
    sample_time     DATETIME(3) NOT NULL COMMENT '精确到毫秒',
    hr              INT COMMENT '心率',
    sbp             INT COMMENT '收缩压',
    dbp             INT COMMENT '舒张压',
    map             INT COMMENT '平均压',
    spo2            INT COMMENT '血氧',
    etco2           INT COMMENT '呼末CO2',
    temperature     DECIMAL(4,1) COMMENT '体温',
    rr              INT COMMENT '呼吸频率',
    bis             INT COMMENT 'BIS脑电双频指数',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_record_time (record_id, sample_time)
);
```

---

## 17.5 移动护理/移动医生

### 功能详述

| 功能 | 说明 |
|---|---|
| 患者识别 | 扫描腕带确认患者身份 |
| 医嘱执行 | PDA端扫码执行医嘱（三查七对） |
| 体征采集 | 移动端录入体征数据 |
| 护理评估 | 床旁完成护理评估 |
| 巡视记录 | 病房巡视电子化 |
| 标本采集 | 扫码确认采集，自动记录时间 |
| 用药核对 | 扫码核对患者-药品-医嘱一致性 |
| 医生查房 | 移动端查看患者信息、下达医嘱 |

### 技术方案

```
方案选型：
  方案A：原生APP（iOS + Android）— 体验最好，成本最高
  方案B：混合开发（Flutter/React Native）— 体验好，成本适中
  方案C：H5 + 企业微信/钉钉 — 成本最低，依赖宿主

推荐：方案B（Flutter），一套代码覆盖手机+PDA+平板

离线支持：
  - 核心数据本地缓存（SQLite）
  - 断网时支持基本操作（体征录入、巡视记录）
  - 恢复网络后自动同步（冲突解决：以最后修改为准）

扫码方案：
  - 药品条码：一维码/二维码
  - 患者腕带：二维码（含患者ID）
  - 标本条码：一维码
  - 高值耗材：UDI码
```

---

## 17.6 BI与数据仓库

### 数据仓库分层

```
┌──────────────────────────────────────────────┐
│  ADS（应用数据层）— 报表/驾驶舱/API         │
├──────────────────────────────────────────────┤
│  DWS（汇总数据层）— 多维聚合指标             │
├──────────────────────────────────────────────┤
│  DWD（明细数据层）— 清洗后的业务明细          │
├──────────────────────────────────────────────┤
│  ODS（操作数据层）— 业务库镜像               │
├──────────────────────────────────────────────┤
│  业务数据库（HIS各子系统）                    │
└──────────────────────────────────────────────┘
```

### ETL流程

```sql
-- 数据仓库库表设计

-- ODS层：镜像业务表（每日增量同步）
-- 使用DataX/Canal从HIS业务库增量抽取

-- DWD层：清洗后的明细
CREATE TABLE dwd_outpatient_visit (
    id              BIGINT PRIMARY KEY,
    hospital_id     BIGINT,
    visit_date      DATE,
    dept_id         BIGINT,
    dept_name       VARCHAR(128),
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    patient_id      BIGINT,
    gender          VARCHAR(8),
    age             INT,
    visit_type      VARCHAR(16),
    diagnosis_code  VARCHAR(32),
    diagnosis_name  VARCHAR(256),
    total_fee       DECIMAL(12,2),
    drug_fee        DECIMAL(12,2),
    exam_fee        DECIMAL(12,2),
    lab_fee         DECIMAL(12,2),
    treat_fee       DECIMAL(12,2),
    insurance_amount DECIMAL(12,2),
    self_pay_amount DECIMAL(12,2),
    etl_time        DATETIME,
    INDEX idx_date (visit_date),
    INDEX idx_dept (dept_id, visit_date)
) PARTITION BY RANGE (YEAR(visit_date)) (
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026),
    PARTITION p2026 VALUES LESS THAN (2027)
);

-- DWS层：聚合指标
CREATE TABLE dws_daily_dept_stat (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    stat_date       DATE NOT NULL,
    dept_id         BIGINT NOT NULL,
    op_visit_count  INT DEFAULT 0,
    op_reg_count    INT DEFAULT 0,
    ip_admit_count  INT DEFAULT 0,
    ip_discharge_count INT DEFAULT 0,
    surgery_count   INT DEFAULT 0,
    total_revenue   DECIMAL(14,2) DEFAULT 0,
    drug_revenue    DECIMAL(14,2) DEFAULT 0,
    avg_visit_time  DECIMAL(8,1) COMMENT '平均就诊时长(分钟)',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stat (hospital_id, stat_date, dept_id)
);

-- ADS层：院长驾驶舱指标
CREATE TABLE ads_dashboard_indicator (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    indicator_code  VARCHAR(64) NOT NULL COMMENT '指标编码',
    indicator_name  VARCHAR(128) NOT NULL,
    indicator_value DECIMAL(14,2),
    indicator_unit  VARCHAR(16),
    stat_date       DATE NOT NULL,
    stat_dim        VARCHAR(16) COMMENT 'HOSPITAL/DEPT/DOCTOR',
    dim_id          BIGINT,
    dim_name        VARCHAR(128),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_indicator (hospital_id, indicator_code, stat_date)
);
```

### 核心BI指标

| 指标分类 | 指标 | 计算逻辑 |
|---|---|---|
| 门诊量 | 日门诊量 | count(op_visit) where date=today |
| 门诊量 | 同比增长率 | (今年-去年)/去年 |
| 收入 | 药占比 | drug_revenue / total_revenue |
| 收入 | 耗占比 | material_revenue / total_revenue |
| 住院 | 床位使用率 | bed_occupied / bed_total |
| 住院 | 平均住院日 | sum(住院天数) / 出院人数 |
| 医疗质量 | 术前平均等待天数 | avg(手术日-入院日) |
| 医保 | 次均费用 | total_cost / 就诊人次 |
| 医保 | DRG权重 | sum(drg_weight) |

---

## 17.7 统一预约平台

### 功能详述

| 功能 | 说明 |
|---|---|
| 预约中心 | 统一管理所有预约资源（门诊/检查/检验/体检/手术） |
| 多渠道接入 | 微信/支付宝/APP/网站/电话/窗口统一接入 |
| 号源池 | 统一号源管理，避免渠道间冲突 |
| 智能推荐 | 根据症状推荐科室/医生 |
| 预约规则 | 统一预约规则引擎（取消/爽约/黑名单） |
| 预约提醒 | 就诊前1天/2小时自动提醒 |
| 预约评价 | 预约后满意度评价 |

### 数据模型

```sql
-- 统一预约资源池
CREATE TABLE appt_resource_pool (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    resource_type   VARCHAR(16) NOT NULL COMMENT 'OUTPATIENT/EXAM/LAB/PE/SURGERY',
    resource_id     BIGINT NOT NULL COMMENT '关联具体资源ID',
    resource_name   VARCHAR(128),
    dept_id         BIGINT,
    doctor_id       BIGINT,
    available_date  DATE NOT NULL,
    time_slot_start TIME,
    time_slot_end   TIME,
    total_quota     INT NOT NULL,
    used_quota      INT DEFAULT 0,
    channel_quota   JSON COMMENT '各渠道配额 {"wechat":10,"app":10,"window":5}',
    status          VARCHAR(16) DEFAULT 'AVAILABLE',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_resource (hospital_id, resource_type, available_date)
);

-- 统一预约记录
CREATE TABLE appt_order (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    order_no        VARCHAR(32) NOT NULL,
    patient_id      BIGINT NOT NULL,
    resource_type   VARCHAR(16) NOT NULL,
    resource_pool_id BIGINT NOT NULL,
    appointment_date DATE NOT NULL,
    time_slot_start TIME,
    time_slot_end   TIME,
    channel         VARCHAR(16) NOT NULL COMMENT 'WECHAT/ALIPAY/APP/WEB/PHONE/WINDOW',
    status          VARCHAR(16) DEFAULT 'BOOKED' COMMENT 'BOOKED/CHECKED_IN/CANCELLED/NO_SHOW/COMPLETED',
    remind_status   VARCHAR(16) COMMENT 'PENDING/SENT',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_order_no (hospital_id, order_no)
);
```

---

## 17.8 智能导诊

### 功能详述

| 功能 | 说明 |
|---|---|
| 症状问诊 | 引导式症状问答（部位→性质→伴随症状） |
| 科室推荐 | 基于症状分析推荐科室 |
| 医生推荐 | 推荐擅长该病症的医生 |
| 急诊指引 | 紧急情况自动引导急诊 |
| 预检分诊 | 辅助急诊预检分级 |

```
实现方案：
  方案A：基于知识图谱的症状→科室映射
  方案B：基于大模型的智能问诊（需训练医疗垂域模型）
  方案C：基于决策树的结构化问诊（推荐，可控性强）

推荐：方案C为主 + 方案B辅助
```

```sql
-- 症状知识库
CREATE TABLE symptom_knowledge (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    symptom_code    VARCHAR(32) NOT NULL,
    symptom_name    VARCHAR(64) NOT NULL,
    body_part       VARCHAR(32),
    gender_limit    VARCHAR(8) DEFAULT 'ALL',
    age_range       VARCHAR(32),
    related_dept    JSON COMMENT '推荐科室列表',
    related_disease JSON COMMENT '相关疾病',
    follow_up_questions JSON COMMENT '追问问题',
    danger_signs    JSON COMMENT '危险信号(触发急诊指引)',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 17.9 物联网集成

### 功能详述

| 功能 | 说明 |
|---|---|
| 设备数据采集 | 自动采集医疗设备数据（监护仪/呼吸机/输液泵等） |
| RFID资产追踪 | 高值设备/耗材的定位追踪 |
| 环境监控 | 温湿度监控（药品库/血库/手术室） |
| 患者定位 | RFID/NRF24L01腕带定位（特殊患者） |
| 设备状态 | 设备运行状态实时监控 |

### 技术方案

```
协议层：
  - 医疗设备：HL7 / DICOM / MQTT
  - RFID：EPC Gen2 / ISO 18000-6C
  - 环境传感器：MQTT / CoAP
  - 定位：UWB / BLE 5.0

架构：
  设备层 → 边缘网关(协议转换) → MQTT Broker → 物联网平台 → HIS业务系统

推荐物联网平台：
  - EMQ X（MQTT Broker）
  - ThingsBoard / IoTDB（设备管理）
```

```sql
-- 设备数据采集记录
CREATE TABLE iot_device_data (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    device_id       VARCHAR(64) NOT NULL,
    device_type     VARCHAR(32),
    data_type       VARCHAR(32) COMMENT 'VITAL_SIGN/ENVIRONMENT/STATUS',
    data_payload    JSON NOT NULL,
    collect_time    DATETIME(3) NOT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_device_time (device_id, collect_time)
);

-- 设备注册
CREATE TABLE iot_device (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    device_code     VARCHAR(64) NOT NULL,
    device_name     VARCHAR(128),
    device_type     VARCHAR(32),
    protocol        VARCHAR(16) COMMENT 'MQTT/HL7/DICOM',
    location        VARCHAR(128),
    dept_id         BIGINT,
    status          VARCHAR(16) DEFAULT 'ONLINE',
    last_heartbeat  DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, device_code)
);
```

---

## 17.10 灾备与高可用

### 高可用架构

```
RPO（恢复点目标）：≤ 1分钟
RTO（恢复时间目标）：≤ 15分钟

主备方案：
  ┌─────────────┐     同步复制     ┌─────────────┐
  │  主数据中心  │ ──────────────→ │  备数据中心  │
  │  (生产)     │ ←────────────── │  (热备)     │
  └─────────────┘   故障切换       └─────────────┘

数据库：
  MySQL主从复制（半同步复制）
  关键库表实时同步到备库

应用层：
  K8s多集群部署（主备集群）
  域名DNS自动切换

存储层：
  MinIO跨集群复制
  影像文件双写
```

### 数据备份策略

```
备份类型：
  全量备份：每周日凌晨（mysqldump / xtrabackup）
  增量备份：每日凌晨（binlog）
  实时备份：主从复制（延迟从库，延迟1小时，防误操作）

备份保留：
  日备份保留7天
  周备份保留4周
  月备份保留12个月
  年备份保留3年

恢复演练：
  每季度进行一次恢复演练
  记录恢复时间和数据完整性验证
```

---

# 十八、编码规范

---

## 18.1 业务单号编码规则

| 单号类型 | 格式 | 示例 | 说明 |
|---|---|---|---|
| 住院号 | YYYY + 6位流水 | 2025000001 | 按年重置 |
| 门诊就诊号 | V + YYYYMMDD + 6位 | V20250508000001 | 按日重置 |
| 处方号 | P + YYYYMMDD + 6位 | P20250508000001 | 按日重置 |
| 医嘱号 | O + YYYYMMDD + 6位 | O20250508000001 | 按日重置 |
| 检验申请号 | L + YYYYMMDD + 6位 | L20250508000001 | 按日重置 |
| 影像检查号 | R + YYYYMMDD + 6位 | R20250508000001 | 按日重置 |
| 手术申请号 | S + YYYYMMDD + 6位 | S20250508000001 | 按日重置 |
| 收费单号 | B + YYYYMMDD + 8位 | B2025050800000001 | 按日重置 |
| 预约号 | A + YYYYMMDD + 6位 | A20250508000001 | 按日重置 |

```java
// 单号生成工具（基于Redis自增，保证唯一性和连续性）
public class BillNoGenerator {
    public String generate(String prefix, String pattern) {
        String datePart = LocalDate.now().format(DateTimeFormatter.ofPattern(pattern));
        String key = "his:billno:" + prefix + ":" + datePart;
        long seq = redisTemplate.opsForValue().increment(key);
        // 设置过期时间为2天
        redisTemplate.expire(key, 2, TimeUnit.DAYS);
        return prefix + datePart + String.format("%06d", seq);
    }
}
```

---

## 18.2 互联互通标准化

### 电子病历评级要求（对应等级核心要求）

| 等级 | 核心要求 |
|---|---|
| 三级 | 院内闭环管理（医嘱闭环、检验闭环、检查闭环、手术闭环、输血闭环、药品闭环） |
| 四级 | 全院信息共享、临床决策支持、合理用药审查 |
| 五级 | 区域医疗协同、居民健康档案共享 |
| 六级 | 知识库应用、临床决策支持闭环 |
| 七级 | 全面互联互通、健康医疗大数据应用 |

### 闭环管理清单

```
1. 用药闭环：开嘱→审核→配药→给药→观察
2. 检验闭环：申请→采集→运送→接收→检测→审核→报告
3. 检查闭环：申请→预约→签到→检查→报告→审核
4. 手术闭环：申请→审批→排台→核查→手术→术后→随访
5. 输血闭环：申请→配血→发血→输血→观察→不良反应
6. 危急值闭环：发现→通知→确认→处理→记录
```

---

# 十九、性能与并发设计

---

## 19.1 高并发场景与方案

| 场景 | 并发量 | 方案 |
|---|---|---|
| 放号抢号 | 瞬时高并发 | Redis预加载号源 + Lua脚本原子操作 + 限流 |
| 门诊收费 | 高频读写 | 缓存收费项目 + 异步开票 |
| 检验报告查询 | 高频读 | 读写分离 + Redis缓存 |
| 医嘱执行 | 高频写 | 批量写入 + 异步同步 |
| 报表统计 | 大数据量 | 离线预计算 + 数据仓库 |

### 号源抢号核心逻辑

```lua
-- Redis Lua脚本：原子化号源扣减
-- KEYS[1] = his:source:{scheduleId}:total
-- KEYS[2] = his:source:{scheduleId}:used
-- KEYS[3] = his:source:{scheduleId}:lock:{patientId}
local total = tonumber(redis.call('GET', KEYS[1]))
local used = tonumber(redis.call('GET', KEYS[2]))

-- 检查是否已预约
if redis.call('EXISTS', KEYS[3]) == 1 then
    return -1  -- 已预约
end

-- 检查号源
if used >= total then
    return -2  -- 号源已满
end

-- 扣减号源
redis.call('INCR', KEYS[2])
-- 锁定15分钟
redis.call('SETEX', KEYS[3], 900, '1')
return 1  -- 成功
```

---

## 19.2 数据库优化建议

```sql
-- 核心查询优化：复合索引设计

-- 门诊：按医生+日期查患者列表
CREATE INDEX idx_visit_doctor_date ON op_visit (doctor_id, visit_date, status);

-- 住院：按科室+状态查在院患者
CREATE INDEX idx_admission_dept_status ON ip_admission (dept_id, status, admit_date);

-- 费用：按患者+日期查费用
CREATE INDEX idx_fee_patient_date ON ip_fee_detail (patient_id, fee_date);

-- 医嘱：按住院号+状态查医嘱
CREATE INDEX idx_order_admission_status ON ip_order (admission_id, order_status, order_type);

-- 检验：按状态+时间查待处理
CREATE INDEX idx_lab_order_status ON lab_order (order_status, create_time);

-- 慢查询阈值：200ms
-- 开启慢查询日志，定期分析优化
```

---

# 二十、测试与质量保障

---

## 20.1 测试策略

| 测试类型 | 覆盖范围 | 工具 |
|---|---|---|
| 单元测试 | 核心业务逻辑 | JUnit 5 + Mockito |
| 集成测试 | 接口级测试 | Spring Boot Test + TestContainers |
| 性能测试 | 高并发场景 | JMeter / Gatling |
| 安全测试 | 渗透测试 | OWASP ZAP |
| 业务流程测试 | 端到端流程 | Selenium / Cypress |
| 医保联调 | 医保接口 | 模拟医保平台 |

## 20.2 上线检查清单

```
□ 数据库迁移脚本已验证
□ 配置参数已切换为生产环境
□ 第三方接口已联调通过（医保/支付/短信）
□ 性能测试通过（并发/响应时间/稳定性）
□ 安全扫描通过（SQL注入/XSS/越权）
□ 灾备切换演练通过
□ 回滚方案已准备
□ 监控告警已配置
□ 运维文档已交付
□ 用户培训已完成
```

---

# 附录A：数据模型总索引

> 按子系统汇总所有数据库表，便于查阅。

| 子系统 | 表名 | 说明 |
|---|---|---|
| 系统管理 | sys_hospital | 医院/院区 |
| | sys_department | 科室 |
| | sys_bed | 床位 |
| | sys_user | 用户 |
| | sys_role | 角色 |
| | sys_menu | 菜单 |
| | sys_tenant | 租户 |
| | sys_dict_type / sys_dict_data | 字典 |
| | sys_config | 系统配置 |
| | sys_print_template | 打印模板 |
| | sys_message | 消息 |
| | sys_operation_log / sys_login_log / sys_data_audit | 日志审计 |
| 门急诊 | op_schedule_template / op_schedule_plan | 排班 |
| | op_appointment / op_registration | 预约/挂号 |
| | op_queue / op_consulting_room | 分诊 |
| | op_visit / op_diagnosis / op_prescription | 就诊/诊断/处方 |
| | op_order / op_treatment_exec | 医嘱/治疗执行 |
| | er_triage / er_rescue / er_time_node | 急诊 |
| 住院 | ip_admission / ip_deposit / ip_bed_change | 入院/预交金/转床 |
| | ip_order / ip_order_exec / ip_medical_record | 医嘱/执行/病程 |
| | ip_vital_signs / ip_nursing_record | 体征/护理 |
| | ip_surgery_apply / ip_surgery_schedule / ip_surgery_record | 手术 |
| | ip_consultation / ip_discharge | 会诊/出院 |
| 电子病历 | emr_document / emr_revision / emr_template | 病历/痕迹/模板 |
| | emr_quality_rule / emr_quality_check | 质控 |
| 药品 | drug_stock / drug_stock_in / drug_stock_out | 库存/入库/出库 |
| | drug_stock_check / drug_purchase_plan | 盘点/采购 |
| | drug_dispensing / drug_return / drug_rational_check | 调配/退药/合理用药 |
| | drug_supplier | 供应商 |
| 收费财务 | fee_bill / fee_bill_item / fee_refund | 收费/明细/退费 |
| | ip_fee_detail / ip_settlement | 住院费用/结算 |
| | fee_invoice | 发票 |
| 医技 | lab_order / lab_order_item / lab_critical_value | 检验 |
| | pacs_exam / pacs_report | 影像 |
| | path_order | 病理 |
| | blood_inventory | 血库 |
| 医保 | mi_item_mapping / mi_settlement / drg_case | 医保 |
| 患者 | patient_master / patient_merge_log | 患者主索引 |
| | internet_consult / internet_consult_message | 互联网医院 |
| | followup_plan / followup_task | 随访 |
| 新增模块 | cdss_knowledge / cdss_rule / cdss_trigger_log | CDSS |
| | ni_case / ni_environment_monitor | 院感 |
| | pe_package / pe_register / pe_result | 体检 |
| | anesthesia_record / anesthesia_vital_signs | 麻醉 |
| | appt_resource_pool / appt_order | 统一预约 |
| | iot_device / iot_device_data | 物联网 |
| 统计 | stat_daily_snapshot | 院长驾驶舱 |
| | dwd_outpatient_visit / dws_daily_dept_stat / ads_dashboard_indicator | 数据仓库 |

---

> **本文档补充完毕。** 与原文档合在一起，构成了一套完整的HIS系统详细设计文档，覆盖了从基础平台到临床业务、从技术架构到安全合规的完整设计。

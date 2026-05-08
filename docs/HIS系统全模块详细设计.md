# HIS 系统全模块详细设计

> 这是一个大工程，我按模块逐一展开，每个模块覆盖：**功能详述、核心流程、数据模型、业务规则、模块依赖**。

---

# 一、基础平台层

---

## 1.1 组织架构管理

### 功能详述

组织架构是整个 HIS 的骨架，采用 **树形多级结构**，支持多院区场景。

```
医院集团
├── 院区A
│   ├── 门诊部
│   │   ├── 内科门诊
│   │   ├── 外科门诊
│   │   └── ...
│   ├── 住院部
│   │   ├── 内科病区
│   │   │   ├── 1楼病区
│   │   │   └── 2楼病区
│   │   └── ...
│   ├── 医技科室
│   ├── 药剂科
│   ├── 职能科室
│   └── ...
├── 院区B
│   └── ...
```

**核心功能点：**

| 功能 | 说明 |
|---|---|
| 科室树管理 | 支持无限层级的科室树，拖拽排序 |
| 科室类型 | 门诊科室、住院病区、医技科室、职能科室、药房药库等类型标记 |
| 科室属性 | 科室代码、名称、简称、所属院区、上级科室、排序号、状态 |
| 院区管理 | 多院区独立管理，支持院区间数据隔离或共享 |
| 病区与床位关联 | 病区下挂床位，床位有类型（普通/监护/VIP）、状态（空闲/占用/维修） |
| 科室合并与停用 | 支持历史数据保留的科室合并、停用（不物理删除） |
| 科室工作时间 | 每个科室可独立配置工作时间、排班规则 |

### 数据模型

```sql
-- 医院/院区表
CREATE TABLE sys_hospital (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_code   VARCHAR(32) NOT NULL UNIQUE COMMENT '医院编码',
    hospital_name   VARCHAR(128) NOT NULL COMMENT '医院名称',
    hospital_level  VARCHAR(16) COMMENT '医院等级(一甲/二甲/三甲等)',
    address         VARCHAR(256),
    contact_phone   VARCHAR(32),
    logo_url        VARCHAR(512),
    status          TINYINT DEFAULT 1 COMMENT '1-启用 0-停用',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 科室表
CREATE TABLE sys_department (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL COMMENT '所属医院',
    parent_id       BIGINT DEFAULT 0 COMMENT '上级科室ID, 0表示顶级',
    dept_code       VARCHAR(32) NOT NULL COMMENT '科室编码',
    dept_name       VARCHAR(128) NOT NULL COMMENT '科室名称',
    dept_short_name VARCHAR(32) COMMENT '科室简称',
    dept_type       VARCHAR(32) NOT NULL COMMENT '科室类型: OUTPATIENT/INPATIENT/TECH/PHARMACY/ADMIN',
    dept_category   VARCHAR(32) COMMENT '科室分类: 内科/外科/妇产科/...',
    sort_order      INT DEFAULT 0,
    is_clinical     TINYINT DEFAULT 1 COMMENT '是否临床科室',
    has_bed         TINYINT DEFAULT 0 COMMENT '是否有床位',
    work_hours      JSON COMMENT '工作时间配置',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_code (hospital_id, dept_code)
);

-- 床位表
CREATE TABLE sys_bed (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    dept_id         BIGINT NOT NULL COMMENT '所属病区',
    bed_no          VARCHAR(16) NOT NULL COMMENT '床位号',
    bed_name        VARCHAR(32) COMMENT '床位名称',
    bed_type        VARCHAR(16) COMMENT 'NORMAL/MONITOR/VIP/ISOLATION',
    bed_status      VARCHAR(16) DEFAULT 'IDLE' COMMENT 'IDLE/OCCUPIED/MAINTENANCE/RESERVED',
    floor           VARCHAR(16) COMMENT '楼层',
    room_no         VARCHAR(16) COMMENT '房间号',
    daily_fee       DECIMAL(10,2) COMMENT '每日床位费',
    sort_order      INT DEFAULT 0,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dept_bed (dept_id, bed_no)
);
```

### 业务规则

- 科室编码全局唯一（同一医院内）
- 科室停用后，关联的历史数据仍可查询，但不可新增业务
- 有在院患者的病区/床位不可停用
- 床位状态变更需记录操作日志

---

## 1.2 人员与权限管理

### 功能详述

采用经典的 **RBAC（基于角色的访问控制）** 模型，支持数据权限隔离。

**权限模型设计：**

```
用户 ──→ 角色 ──→ 菜单权限（功能权限）
  │                └──→ 数据权限（科室/院区范围）
  └──→ 直接数据权限（可覆盖角色的数据权限）
```

**核心功能点：**

| 功能 | 说明 |
|---|---|
| 用户管理 | 账号创建、启用/停用、密码重置、登录策略 |
| 角色管理 | 角色创建、角色与菜单/按钮权限绑定 |
| 菜单管理 | 多级菜单树、按钮级权限（新增/编辑/删除/导出/打印） |
| 数据权限 | 按角色控制可见数据范围：全院/本科室/本人/指定科室 |
| 医护人员档案 | 工号、姓名、职称、执业证书、所属科室、岗位类型 |
| 多科室归属 | 一个医生可属于多个科室（门诊+病房） |
| 登录安全 | 密码复杂度、登录失败锁定、会话超时、单设备登录 |

### 数据模型

```sql
-- 用户表
CREATE TABLE sys_user (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    username        VARCHAR(64) NOT NULL COMMENT '登录账号',
    password        VARCHAR(128) NOT NULL COMMENT '密码(BCrypt加密)',
    real_name       VARCHAR(64) NOT NULL COMMENT '真实姓名',
    employee_no     VARCHAR(32) COMMENT '工号',
    phone           VARCHAR(16),
    email           VARCHAR(128),
    avatar_url      VARCHAR(512),
    user_type       VARCHAR(16) NOT NULL COMMENT 'DOCTOR/NURSE/TECH/PHARMACIST/ADMIN',
    primary_dept_id BIGINT COMMENT '主科室ID',
    status          TINYINT DEFAULT 1,
    last_login_time DATETIME,
    last_login_ip   VARCHAR(64),
    password_update_time DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_username (hospital_id, username)
);

-- 用户-科室关联（支持多科室）
CREATE TABLE sys_user_dept (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id         BIGINT NOT NULL,
    dept_id         BIGINT NOT NULL,
    is_primary      TINYINT DEFAULT 0 COMMENT '是否主科室',
    position        VARCHAR(64) COMMENT '岗位',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_user_dept (user_id, dept_id)
);

-- 角色表
CREATE TABLE sys_role (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    role_code       VARCHAR(64) NOT NULL,
    role_name       VARCHAR(128) NOT NULL,
    data_scope      VARCHAR(32) DEFAULT 'SELF_DEPT' COMMENT 'ALL/ALL_CLINICAL/SPECIFIED_DEPT/SELF_DEPT/SELF',
    description     VARCHAR(256),
    sort_order      INT DEFAULT 0,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_code (hospital_id, role_code)
);

-- 用户-角色关联
CREATE TABLE sys_user_role (
    id      BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    UNIQUE KEY uk_user_role (user_id, role_id)
);

-- 菜单表
CREATE TABLE sys_menu (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    parent_id       BIGINT DEFAULT 0,
    menu_name       VARCHAR(64) NOT NULL,
    menu_code       VARCHAR(64) NOT NULL COMMENT '权限标识',
    menu_type       VARCHAR(16) NOT NULL COMMENT 'CATALOG/MENU/BUTTON',
    path            VARCHAR(256) COMMENT '路由路径',
    component       VARCHAR(256) COMMENT '前端组件路径',
    icon            VARCHAR(64),
    sort_order      INT DEFAULT 0,
    visible         TINYINT DEFAULT 1,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 角色-菜单关联
CREATE TABLE sys_role_menu (
    id       BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id  BIGINT NOT NULL,
    menu_id  BIGINT NOT NULL,
    UNIQUE KEY uk_role_menu (role_id, menu_id)
);

-- 角色-数据权限关联（指定科室范围时用）
CREATE TABLE sys_role_dept (
    id       BIGINT PRIMARY KEY AUTO_INCREMENT,
    role_id  BIGINT NOT NULL,
    dept_id  BIGINT NOT NULL,
    UNIQUE KEY uk_role_dept (role_id, dept_id)
);
```

### 业务规则

- 密码必须 BCrypt 加密存储，禁止明文
- 默认密码策略：至少8位，含大小写字母+数字
- 连续5次登录失败锁定30分钟
- 会话默认超时30分钟，可配置
- 管理员角色不可删除，可停用
- 用户停用后立即踢出当前会话

---

## 1.3 多租户管理

### 功能详述

产品化 HIS 的关键能力，支持一套系统服务多家医院。

**隔离策略：共享数据库 + 租户字段隔离（适合中小型客户）**

> 所有业务表增加 `hospital_id` 字段，查询时自动注入租户过滤条件。

| 功能 | 说明 |
|---|---|
| 租户注册 | 新医院开通，初始化基础数据 |
| 租户配置 | 每家医院独立的系统参数、字典、流程配置 |
| 数据隔离 | MyBatis 拦截器自动注入 `hospital_id` 过滤条件 |
| 租户管理 | 启用/停用/注销租户，数据导出/清理 |
| 套餐与计费 | 不同版本（基础版/专业版/旗舰版）功能模块不同 |

### 核心实现思路

```
// MyBatis 拦截器伪代码
@Intercepts({
    @Signature(type = StatementHandler.class, method = "prepare", ...)
})
public class TenantInterceptor implements Interceptor {
    @Override
    public Object intercept(Invocation invocation) {
        // 1. 从当前上下文获取 hospital_id
        Long hospitalId = TenantContext.getHospitalId();
        // 2. 获取原始SQL
        // 3. 判断表是否需要租户过滤（白名单机制）
        // 4. 自动追加 WHERE hospital_id = ?
    }
}
```

### 数据模型

```sql
-- 租户表
CREATE TABLE sys_tenant (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_code     VARCHAR(32) NOT NULL UNIQUE COMMENT '租户编码',
    tenant_name     VARCHAR(128) NOT NULL COMMENT '医院名称',
    contact_name    VARCHAR(64),
    contact_phone   VARCHAR(16),
    package_type    VARCHAR(32) DEFAULT 'BASIC' COMMENT 'BASIC/PRO/ULTIMATE',
    expire_date     DATE COMMENT '服务到期日',
    max_users       INT DEFAULT 50 COMMENT '最大用户数',
    status          TINYINT DEFAULT 1 COMMENT '1-正常 0-停用 2-试用',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 租户功能模块配置
CREATE TABLE sys_tenant_module (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT,
    tenant_id   BIGINT NOT NULL,
    module_code VARCHAR(64) NOT NULL COMMENT '模块编码',
    enabled     TINYINT DEFAULT 1,
    expire_date DATE,
    UNIQUE KEY uk_tenant_module (tenant_id, module_code)
);
```

---

## 1.4 基础数据字典

### 功能详述

统一管理系统所有枚举值、编码标准、对照关系。

| 功能 | 说明 |
|---|---|
| 字典分类管理 | 字典类型分组（诊断字典/收费项目/药品目录/...） |
| 字典项管理 | 字典值的增删改查、排序、启用停用 |
| 国标字典维护 | ICD-10疾病诊断、ICD-9-CM-3手术操作、国家药品目录 |
| 医保目录对照 | 医院收费项目与医保目录的对照关系 |
| 多版本管理 | 字典数据版本控制，支持历史版本追溯 |
| 字典同步 | 从国家标准库同步更新字典数据 |

### 数据模型

```sql
-- 字典类型
CREATE TABLE sys_dict_type (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    dict_type_code  VARCHAR(64) NOT NULL COMMENT '字典类型编码',
    dict_type_name  VARCHAR(128) NOT NULL COMMENT '字典类型名称',
    is_system       TINYINT DEFAULT 0 COMMENT '是否系统内置',
    description     VARCHAR(256),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_type_code (dict_type_code)
);

-- 字典数据
CREATE TABLE sys_dict_data (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    dict_type_code  VARCHAR(64) NOT NULL,
    dict_code       VARCHAR(64) NOT NULL COMMENT '字典项编码',
    dict_value      VARCHAR(256) NOT NULL COMMENT '字典项值',
    parent_code     VARCHAR(64) DEFAULT '' COMMENT '上级编码(树形字典用)',
    sort_order      INT DEFAULT 0,
    is_default      TINYINT DEFAULT 0,
    css_class       VARCHAR(64) COMMENT '前端样式',
    remark          VARCHAR(256),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_type_code (dict_type_code, dict_code)
);

-- ICD-10 疾病诊断字典
CREATE TABLE dict_icd10 (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    icd_code        VARCHAR(32) NOT NULL COMMENT 'ICD-10编码',
    disease_name    VARCHAR(256) NOT NULL COMMENT '疾病名称',
    disease_name_en VARCHAR(256),
    category_code   VARCHAR(16) COMMENT '类目编码(A00-Z99)',
    category_name   VARCHAR(128),
    is_infectious   TINYINT DEFAULT 0 COMMENT '是否传染病',
    is_tumor        TINYINT DEFAULT 0 COMMENT '是否肿瘤',
    status          TINYINT DEFAULT 1,
    UNIQUE KEY uk_icd_code (icd_code)
);

-- ICD-9-CM-3 手术操作字典
CREATE TABLE dict_icd9cm3 (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    operation_code  VARCHAR(32) NOT NULL,
    operation_name  VARCHAR(256) NOT NULL,
    category_code   VARCHAR(16),
    category_name   VARCHAR(128),
    status          TINYINT DEFAULT 1,
    UNIQUE KEY uk_op_code (operation_code)
);

-- 收费项目字典
CREATE TABLE dict_charge_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL COMMENT '0表示国家标准项目',
    item_code       VARCHAR(32) NOT NULL,
    item_name       VARCHAR(256) NOT NULL,
    item_type       VARCHAR(32) NOT NULL COMMENT 'DRUG/EXAM/LAB/TREAT/MATERIAL/BED/FEE',
    specification   VARCHAR(128) COMMENT '规格(药品用)',
    unit            VARCHAR(16) COMMENT '单位',
    unit_price      DECIMAL(12,4) COMMENT '单价',
    dosage_form     VARCHAR(32) COMMENT '剂型(药品用)',
    manufacturer    VARCHAR(128) COMMENT '生产厂家',
    approval_no     VARCHAR(64) COMMENT '批准文号',
    medical_insurance_code VARCHAR(32) COMMENT '医保编码',
    medical_insurance_type  VARCHAR(16) COMMENT '甲类/乙类/丙类',
    is_medical_insurance    TINYINT DEFAULT 0,
    is_active       TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_code (hospital_id, item_code)
);
```

---

## 1.5 工作流引擎

### 功能详述

支撑 HIS 中各类审批和业务流转场景。

| 功能 | 说明 |
|---|---|
| 流程定义 | 可视化流程设计器（或配置式），定义节点、条件、审批人 |
| 流程模板 | 预置常用流程模板（处方审批、会诊审批、请假审批等） |
| 流程实例 | 运行中的流程实例，支持挂起/恢复/终止 |
| 任务管理 | 待办任务、已办任务、委托/转办/加签 |
| 表单引擎 | 与业务表单关联，支持自定义表单 |
| 流程监控 | 流程运行状态监控、超时预警 |

### 核心流程节点类型

```
开始节点 → 审批节点 → 条件分支 → 并行网关 → 抄送节点 → 结束节点
              ↓
         自动节点（调用外部接口/自动计算）
```

### 数据模型

```sql
-- 流程定义
CREATE TABLE wf_process_definition (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    process_key     VARCHAR(64) NOT NULL COMMENT '流程标识',
    process_name    VARCHAR(128) NOT NULL,
    version         INT DEFAULT 1,
    category        VARCHAR(64) COMMENT '流程分类',
    form_key        VARCHAR(64) COMMENT '关联表单标识',
    process_config  JSON COMMENT '流程节点配置(JSON)',
    description     VARCHAR(512),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_key_version (process_key, version)
);

-- 流程实例
CREATE TABLE wf_process_instance (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    process_def_id  BIGINT NOT NULL,
    business_key    VARCHAR(128) COMMENT '业务主键',
    business_type   VARCHAR(64) COMMENT '业务类型',
    initiator_id    BIGINT COMMENT '发起人',
    initiator_name  VARCHAR(64),
    title           VARCHAR(256) COMMENT '流程标题',
    status          VARCHAR(16) DEFAULT 'RUNNING' COMMENT 'RUNNING/COMPLETED/CANCELLED/SUSPENDED',
    start_time      DATETIME,
    end_time        DATETIME,
    variables       JSON COMMENT '流程变量',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 任务表
CREATE TABLE wf_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    process_inst_id BIGINT NOT NULL,
    task_name       VARCHAR(128) NOT NULL,
    task_type       VARCHAR(32) COMMENT 'APPROVE/COUNTERSIGN/NOTIFY',
    assignee_id     BIGINT COMMENT '处理人ID',
    assignee_name   VARCHAR(64),
    candidate_ids   VARCHAR(512) COMMENT '候选人ID列表',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/COMPLETED/DELEGATED/TRANSFERRED',
    comment         VARCHAR(512) COMMENT '审批意见',
    result          VARCHAR(32) COMMENT 'APPROVED/REJECTED',
    due_time        DATETIME COMMENT '截止时间',
    complete_time   DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 1.6 消息中心

| 功能 | 说明 |
|---|---|
| 消息模板 | 按业务场景定义消息模板（变量占位符） |
| 消息发送 | 统一发送接口，支持站内信/短信/微信/APP推送 |
| 消息队列 | 异步发送，支持重试、失败记录 |
| 已读/未读 | 消息状态管理、未读数统计 |
| 消息订阅 | 用户可配置接收哪些类型的消息通知 |

### 数据模型

```sql
CREATE TABLE sys_message (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    msg_type        VARCHAR(32) NOT NULL COMMENT 'SYSTEM/BUSINESS/ALERT/APPROVAL',
    channel         VARCHAR(16) NOT NULL COMMENT 'INTERNAL/SMS/WECHAT/PUSH',
    title           VARCHAR(256),
    content         TEXT,
    receiver_id     BIGINT NOT NULL,
    sender_id       BIGINT,
    business_type   VARCHAR(64) COMMENT '关联业务类型',
    business_id     BIGINT COMMENT '关联业务ID',
    is_read         TINYINT DEFAULT 0,
    read_time       DATETIME,
    send_status     VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/SENT/FAILED',
    send_time       DATETIME,
    retry_count     INT DEFAULT 0,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_receiver (receiver_id, is_read)
);
```

---

## 1.7 系统日志与审计

| 功能 | 说明 |
|---|---|
| 操作日志 | 记录谁在什么时间做了什么操作（增删改查） |
| 登录日志 | 登录/登出记录、登录IP、设备信息 |
| 数据变更审计 | 关键数据的变更前后值对比（diff记录） |
| 日志查询 | 多条件组合查询、导出 |
| 日志保留策略 | 按配置周期自动归档/清理 |

### 数据模型

```sql
CREATE TABLE sys_operation_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT,
    user_id         BIGINT,
    user_name       VARCHAR(64),
    module          VARCHAR(64) COMMENT '模块名称',
    operation       VARCHAR(64) COMMENT '操作类型',
    method          VARCHAR(256) COMMENT '请求方法',
    request_url     VARCHAR(512),
    request_method  VARCHAR(16),
    request_params  TEXT,
    response_data   TEXT,
    ip              VARCHAR(64),
    duration        BIGINT COMMENT '耗时(ms)',
    status          TINYINT COMMENT '1-成功 0-失败',
    error_msg       TEXT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hospital_time (hospital_id, create_time)
);

CREATE TABLE sys_login_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT,
    user_id         BIGINT,
    user_name       VARCHAR(64),
    login_ip        VARCHAR(64),
    user_agent      VARCHAR(512),
    login_type      VARCHAR(16) COMMENT 'ACCOUNT/MOBILE/SSO',
    status          TINYINT COMMENT '1-成功 0-失败',
    fail_reason     VARCHAR(128),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_time (user_id, create_time)
);

CREATE TABLE sys_data_audit (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT,
    user_id         BIGINT,
    user_name       VARCHAR(64),
    table_name      VARCHAR(64) NOT NULL,
    record_id       BIGINT NOT NULL,
    operation       VARCHAR(16) NOT NULL COMMENT 'INSERT/UPDATE/DELETE',
    old_value       JSON COMMENT '变更前数据',
    new_value       JSON COMMENT '变更后数据',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_table_record (table_name, record_id)
);
```

---

## 1.8 参数配置中心

| 功能 | 说明 |
|---|---|
| 系统参数 | 全局系统参数（如默认密码、会话超时时间等） |
| 业务参数 | 各模块业务规则参数（如处方有效期、退费时限等） |
| 分级配置 | 系统级 > 医院级 > 科室级，支持覆盖 |
| 参数分组 | 按模块分组展示和管理 |

```sql
CREATE TABLE sys_config (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT DEFAULT 0 COMMENT '0=系统级',
    config_group    VARCHAR(64) NOT NULL COMMENT '配置分组',
    config_key      VARCHAR(128) NOT NULL,
    config_value    TEXT,
    config_type     VARCHAR(16) COMMENT 'STRING/NUMBER/BOOLEAN/JSON',
    description     VARCHAR(256),
    is_system       TINYINT DEFAULT 0 COMMENT '是否系统参数(不可删除)',
    sort_order      INT DEFAULT 0,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_key (hospital_id, config_key)
);
```

---

## 1.9 打印管理

| 功能 | 说明 |
|---|---|
| 打印模板 | 可视化模板设计器（处方、报告、标签、票据等） |
| 模板变量 | 绑定业务数据字段，运行时自动填充 |
| 打印任务 | 打印任务队列管理、重打 |
| 打印机管理 | 打印机注册、分组（处方打印机/标签打印机/票据打印机） |
| 套打支持 | 支持预印纸张的精确定位打印 |

```sql
CREATE TABLE sys_print_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    template_code   VARCHAR(64) NOT NULL,
    template_name   VARCHAR(128) NOT NULL,
    business_type   VARCHAR(64) NOT NULL COMMENT 'PRESCRIPTION/REPORT/LABEL/RECEIPT',
    template_content TEXT COMMENT '模板HTML内容',
    paper_size      VARCHAR(16) DEFAULT 'A5' COMMENT 'A4/A5/A6/CUSTOM',
    orientation     VARCHAR(16) DEFAULT 'PORTRAIT',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_hospital_code (hospital_id, template_code)
);
```

---

# 二、门急诊业务

---

## 2.1 预约挂号

### 功能详述

| 功能 | 说明 |
|---|---|
| 号源池管理 | 按科室/医生/日期/时段管理可用号源数量 |
| 排班关联 | 号源基于排班自动生成 |
| 预约渠道 | 窗口预约、自助机预约、微信/支付宝/APP/电话预约 |
| 分时段预约 | 可配置时段粒度（如每15分钟一个时段） |
| 预约规则 | 提前预约天数、每人每日限约次数、爽约黑名单 |
| 预约确认 | 预约成功后发送短信/微信提醒 |
| 退号/取消 | 预约取消规则（提前多久可取消） |
| 爽约管理 | 未按时就诊标记爽约，累计爽约进入黑名单 |
| 加号管理 | 医生可手动加号，加号号源独立管理 |

### 核心业务流程

```
患者选择科室/医生/日期
    ↓
系统展示可用号源（按时段）
    ↓
患者选择时段 → 锁号（15分钟有效）
    ↓
确认预约信息 → 支付挂号费（可选线上/到院支付）
    ↓
预约成功 → 生成预约记录 → 发送确认通知
    ↓
就诊当日 → 签到/取号 → 进入候诊队列
```

### 数据模型

```sql
-- 排班模板
CREATE TABLE op_schedule_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    dept_id         BIGINT NOT NULL COMMENT '科室',
    doctor_id       BIGINT COMMENT '医生(为空表示科室公共号源)',
    schedule_type   VARCHAR(16) NOT NULL COMMENT 'WEEKLY/MONTHLY/CUSTOM',
    day_of_week     TINYINT COMMENT '周几(1-7)',
    time_period     VARCHAR(16) NOT NULL COMMENT 'AM/PM/EVENING',
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    total号源       INT NOT NULL COMMENT '总号源数',
    appointment号源  INT COMMENT '可预约号源数',
    site号源         INT COMMENT '现场号源数',
    visit_type      VARCHAR(16) DEFAULT 'NORMAL' COMMENT 'NORMAL/EXPERT/SPECIAL',
    fee_amount      DECIMAL(10,2) COMMENT '挂号费',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 排班计划（具体日期的排班）
CREATE TABLE op_schedule_plan (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    template_id     BIGINT COMMENT '来源模板',
    dept_id         BIGINT NOT NULL,
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    schedule_date   DATE NOT NULL,
    time_period     VARCHAR(16) NOT NULL,
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    total号源       INT NOT NULL,
    used号源         INT DEFAULT 0 COMMENT '已用号源',
    appointment号源  INT,
    used_appointment INT DEFAULT 0 COMMENT '已预约号源',
    visit_type      VARCHAR(16),
    fee_amount      DECIMAL(10,2),
    status          VARCHAR(16) DEFAULT 'NORMAL' COMMENT 'NORMAL/CANCELLED/SUSPENDED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_schedule (hospital_id, dept_id, doctor_id, schedule_date, time_period)
);

-- 预约记录
CREATE TABLE op_appointment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    appointment_no  VARCHAR(32) NOT NULL COMMENT '预约号',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    schedule_id     BIGINT NOT NULL COMMENT '排班ID',
    dept_id         BIGINT NOT NULL,
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    appointment_date DATE NOT NULL,
    time_slot_start TIME COMMENT '预约时段开始',
    time_slot_end   TIME COMMENT '预约时段结束',
    queue_no        VARCHAR(16) COMMENT '排队序号',
    visit_type      VARCHAR(16),
    channel         VARCHAR(16) COMMENT '预约渠道: WINDOW/SELF/WECHAT/APP/PHONE',
    status          VARCHAR(16) DEFAULT 'BOOKED' COMMENT 'BOOKED/CHECKED_IN/VISITED/CANCELLED/NO_SHOW',
    cancel_reason   VARCHAR(256),
    cancel_time     DATETIME,
    fee_amount      DECIMAL(10,2),
    pay_status      VARCHAR(16) DEFAULT 'UNPAID' COMMENT 'UNPAID/PAID/REFUNDED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_appointment_no (hospital_id, appointment_no),
    INDEX idx_patient (patient_id),
    INDEX idx_date_dept (appointment_date, dept_id)
);
```

### 业务规则

- 同一患者同一天同一医生只能预约一个号
- 预约后15分钟内未支付自动释放号源
- 就诊日前一天16:00前可取消预约（可配置）
- 3个月内累计爽约3次，进入黑名单30天
- 退号后号源自动释放回号源池
- 医生停诊后，已预约患者自动收到通知

---

## 2.2 现场挂号

| 功能 | 说明 |
|---|---|
| 窗口挂号 | 选择科室/医生/号别，收费后生成挂号记录 |
| 自助挂号 | 自助机上操作，支持医保卡/电子健康卡/身份证 |
| 号源实时查询 | 实时显示各科室/医生剩余号源 |
| 挂号费收取 | 支持现金/微信/支付宝/医保 |

```sql
-- 挂号记录（统一线上门下的挂号）
CREATE TABLE op_registration (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    reg_no          VARCHAR(32) NOT NULL COMMENT '挂号单号',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64) NOT NULL,
    gender          VARCHAR(8),
    age             INT,
    age_unit        VARCHAR(4) DEFAULT '岁',
    id_card         VARCHAR(32),
    phone           VARCHAR(16),
    medical_card_no VARCHAR(32) COMMENT '就诊卡号',
    appointment_id  BIGINT COMMENT '关联预约ID(预约挂号时有值)',
    dept_id         BIGINT NOT NULL,
    dept_name       VARCHAR(128),
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    reg_date        DATE NOT NULL COMMENT '挂号日期',
    visit_date      DATE NOT NULL COMMENT '就诊日期',
    time_period     VARCHAR(16) COMMENT 'AM/PM',
    queue_no        VARCHAR(16) COMMENT '排队序号',
    visit_type      VARCHAR(16) NOT NULL COMMENT '普通/专家/特需',
    reg_type        VARCHAR(16) NOT NULL COMMENT 'NORMAL/EMERGENCY/FREE',
    reg_fee         DECIMAL(10,2) DEFAULT 0 COMMENT '挂号费',
    diag_fee        DECIMAL(10,2) DEFAULT 0 COMMENT '诊察费',
    total_fee       DECIMAL(10,2) DEFAULT 0 COMMENT '总费用',
    pay_type        VARCHAR(16) COMMENT '支付方式',
    pay_status      VARCHAR(16) DEFAULT 'UNPAID',
    reg_channel     VARCHAR(16) COMMENT 'WINDOW/SELF/WECHAT',
    status          VARCHAR(16) DEFAULT 'REGISTERED' COMMENT 'REGISTERED/TRIAGED/VISITING/VISITED/CANCELLED',
    cancel_reason   VARCHAR(256),
    cancel_time     DATETIME,
    operator_id     BIGINT COMMENT '操作员',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_reg_no (hospital_id, reg_no),
    INDEX idx_patient (patient_id),
    INDEX idx_visit_date (visit_date, dept_id)
);
```

---

## 2.3 门诊分诊

### 功能详述

| 功能 | 说明 |
|---|---|
| 候诊队列 | 按科室/诊室维护候诊队列 |
| 叫号 | 支持顺序叫号、优先叫号（急诊/老幼/军人） |
| 过号处理 | 过号患者标记，可重新排队 |
| 分诊屏显示 | 候诊区大屏显示当前叫号信息 |
| 诊室状态 | 诊室空闲/就诊中/暂停 |
| 候诊统计 | 各诊室候诊人数、平均等待时间 |

### 核心业务流程

```
患者挂号后 → 到分诊台签到（或自助签到）
    ↓
分诊护士确认 → 分配诊室 → 加入候诊队列
    ↓
医生叫号 → 患者进入诊室 → 状态变为"就诊中"
    ↓
就诊完成 → 状态变为"已就诊" → 从队列移除
```

```sql
-- 候诊队列
CREATE TABLE op_queue (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    reg_id          BIGINT NOT NULL COMMENT '挂号记录ID',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    dept_id         BIGINT NOT NULL,
    doctor_id       BIGINT,
    room_id         BIGINT COMMENT '诊室ID',
    queue_no        VARCHAR(16) NOT NULL COMMENT '排队号',
    queue_type      VARCHAR(16) DEFAULT 'NORMAL' COMMENT 'NORMAL/PRIORITY/EMERGENCY',
    queue_status    VARCHAR(16) DEFAULT 'WAITING' COMMENT 'WAITING/CALLING/IN_VISIT/MISSED/DONE',
    call_time       DATETIME COMMENT '叫号时间',
    visit_start_time DATETIME COMMENT '就诊开始时间',
    visit_end_time  DATETIME COMMENT '就诊结束时间',
    sort_order      INT DEFAULT 0,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_dept_status (dept_id, queue_status)
);

-- 诊室管理
CREATE TABLE op_consulting_room (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    dept_id         BIGINT NOT NULL,
    room_no         VARCHAR(16) NOT NULL,
    room_name       VARCHAR(64),
    current_doctor_id BIGINT COMMENT '当前坐诊医生',
    room_status     VARCHAR(16) DEFAULT 'IDLE' COMMENT 'IDLE/IN_USE/PAUSED',
    display_device  VARCHAR(64) COMMENT '叫号屏设备标识',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 2.4 门诊医生工作站

### 功能详述

门诊医生工作站是 HIS 中**使用频率最高**的模块之一。

| 功能 | 说明 |
|---|---|
| 患者列表 | 当前候诊患者列表、已诊患者列表、历史就诊记录 |
| 诊断录入 | 初步诊断、补充诊断，支持ICD-10检索和拼音首字母检索 |
| 处方开具 | 西药处方、中成药处方、中药饮片处方 |
| 检查申请 | 开具检查申请单（CT/MR/超声/X线/内镜等） |
| 检验申请 | 开具检验申请单（血常规/生化/免疫/微生物等） |
| 治疗申请 | 开具治疗申请（输液/注射/换药/理疗等） |
| 门诊病历 | 书写门诊病历（模板化/结构化） |
| 诊断证明 | 开具诊断证明书 |
| 转诊 | 院内转诊、转外院 |
| 历史查询 | 历史就诊记录、历史处方、历史检查检验结果 |
| 合理用药提醒 | 开药时自动审查药物相互作用、过敏史、配伍禁忌 |
| 常用处方 | 个人常用处方模板，一键调用 |
| 续方 | 基于历史处方快速续方 |

### 核心业务流程

```
患者候诊 → 医生叫号接诊
    ↓
查看患者基本信息/过敏史/历史就诊
    ↓
书写病历（主诉/现病史/查体）
    ↓
录入诊断
    ↓
开具处方/检查/检验/治疗（可同时进行）
    ↓
处方提交 → 合理用药审查 → 审查通过 → 进入收费环节
    ↓
结束就诊 → 病历保存 → 下一位患者
```

### 数据模型

```sql
-- 门诊就诊记录
CREATE TABLE op_visit (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    visit_no        VARCHAR(32) NOT NULL COMMENT '就诊号',
    reg_id          BIGINT COMMENT '挂号ID',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    gender          VARCHAR(8),
    birth_date      DATE,
    age             INT,
    age_unit        VARCHAR(4),
    dept_id         BIGINT NOT NULL,
    dept_name       VARCHAR(128),
    doctor_id       BIGINT NOT NULL,
    doctor_name     VARCHAR(64),
    visit_date      DATE NOT NULL,
    chief_complaint TEXT COMMENT '主诉',
    present_illness TEXT COMMENT '现病史',
    past_history    TEXT COMMENT '既往史',
    allergy_history TEXT COMMENT '过敏史',
    physical_exam   TEXT COMMENT '体格检查',
    status          VARCHAR(16) DEFAULT 'VISITING' COMMENT 'VISITING/COMPLETED/CANCELLED',
    visit_end_time  DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_visit_no (hospital_id, visit_no),
    INDEX idx_patient (patient_id),
    INDEX idx_doctor_date (doctor_id, visit_date)
);

-- 门诊诊断
CREATE TABLE op_diagnosis (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    visit_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    diag_type       VARCHAR(16) NOT NULL COMMENT 'PRIMARY/AUXILIARY/SUSPECTED',
    diag_seq        INT DEFAULT 1 COMMENT '诊断序号',
    icd_code        VARCHAR(32) NOT NULL,
    icd_name        VARCHAR(256) NOT NULL,
    diag_remark     VARCHAR(256),
    doctor_id       BIGINT,
    diag_time       DATETIME,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_visit (visit_id)
);

-- 门诊处方
CREATE TABLE op_prescription (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    presc_no        VARCHAR(32) NOT NULL COMMENT '处方号',
    visit_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    presc_type      VARCHAR(16) NOT NULL COMMENT 'WESTERN/CHINESE_PATENT/CHINESE_HERBAL',
    dept_id         BIGINT NOT NULL,
    doctor_id       BIGINT NOT NULL,
    doctor_name     VARCHAR(64),
    diagnosis       VARCHAR(512),
    presc_status    VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/SUBMITTED/AUDITED/DISPENSED/CANCELLED',
    total_amount    DECIMAL(12,2) DEFAULT 0,
    drug_count      INT DEFAULT 0,
    is_emergency    TINYINT DEFAULT 0,
    remark          VARCHAR(256),
    audit_doctor_id BIGINT COMMENT '审核药师',
    audit_time      DATETIME,
    audit_result    VARCHAR(16) COMMENT 'PASS/REJECT',
    audit_opinion   VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_presc_no (hospital_id, presc_no),
    INDEX idx_visit (visit_id)
);

-- 处方明细
CREATE TABLE op_prescription_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    presc_id        BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL COMMENT '药品ID(dict_charge_item)',
    drug_code       VARCHAR(32) NOT NULL,
    drug_name       VARCHAR(256) NOT NULL,
    specification   VARCHAR(128) COMMENT '规格',
    dosage_form     VARCHAR(32) COMMENT '剂型',
    manufacturer    VARCHAR(128),
    unit            VARCHAR(16) COMMENT '单位',
    unit_price      DECIMAL(12,4) NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL COMMENT '数量',
    dosage          VARCHAR(32) COMMENT '单次剂量',
    dosage_unit     VARCHAR(16) COMMENT '剂量单位',
    frequency       VARCHAR(32) COMMENT '频次(BID/TID/QD/PRN等)',
    route           VARCHAR(32) COMMENT '给药途径(口服/静滴/肌注等)',
    days            INT COMMENT '用药天数',
    skin_test       TINYINT DEFAULT 0 COMMENT '是否需要皮试',
    skin_test_result VARCHAR(16) COMMENT '皮试结果',
    amount          DECIMAL(12,2) NOT NULL COMMENT '金额',
    self_pay        TINYINT DEFAULT 0 COMMENT '自费药标记',
    remark          VARCHAR(256) COMMENT '备注(如饭前/饭后)',
    sort_order      INT DEFAULT 0,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_presc (presc_id)
);

-- 检查检验申请
CREATE TABLE op_order (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    order_no        VARCHAR(32) NOT NULL COMMENT '医嘱/申请单号',
    visit_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    order_type      VARCHAR(16) NOT NULL COMMENT 'EXAM/LAB/TREAT',
    item_id         BIGINT NOT NULL COMMENT '项目ID',
    item_code       VARCHAR(32) NOT NULL,
    item_name       VARCHAR(256) NOT NULL,
    dept_id         BIGINT COMMENT '执行科室',
    doctor_id       BIGINT NOT NULL,
    doctor_name     VARCHAR(64),
    clinical_info   TEXT COMMENT '临床信息/检查目的',
    sample_type     VARCHAR(32) COMMENT '标本类型(检验用)',
    urgency         TINYINT DEFAULT 0 COMMENT '是否加急',
    order_status    VARCHAR(16) DEFAULT 'ORDERED' COMMENT 'ORDERED/ACCEPTED/SAMPLE_COLLECTED/EXECUTING/REPORTED/CANCELLED',
    report_time     DATETIME,
    amount          DECIMAL(12,2),
    remark          VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_order_no (hospital_id, order_no),
    INDEX idx_visit (visit_id)
);
```

### 业务规则

- 处方有效期：当日有效（可配置）
- 门诊处方药品种类不超过5种（中药饮片另计）
- 每张处方金额超过设定阈值需上级审核
- 急诊处方标注后，药房优先调配
- 有药物过敏史的患者，开具相关药物时弹窗警告
- 合理用药审查不通过的处方，医生需填写理由后方可强制提交

---

## 2.5 门诊护士工作站

| 功能 | 说明 |
|---|---|
| 输液管理 | 输液执行、巡视记录、拔针记录 |
| 皮试管理 | 皮试执行、结果录入（阴性/阳性） |
| 注射管理 | 肌注/皮下注射执行记录 |
| 治疗执行 | 换药/雾化/理疗等治疗执行 |
| 执行确认 | 扫码确认执行（患者腕带/处方条码） |
| 工作量统计 | 每日执行工作量统计 |

```sql
-- 治疗执行记录
CREATE TABLE op_treatment_exec (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    visit_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    presc_item_id   BIGINT COMMENT '关联处方明细',
    order_id        BIGINT COMMENT '关联医嘱',
    exec_type       VARCHAR(16) NOT NULL COMMENT 'INFUSION/INJECTION/SKIN_TEST/TREATMENT',
    item_name       VARCHAR(256),
    exec_status     VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/EXECUTING/COMPLETED/STOPPED',
    nurse_id        BIGINT NOT NULL,
    nurse_name      VARCHAR(64),
    exec_time       DATETIME,
    start_time      DATETIME,
    end_time        DATETIME,
    infusion_speed  VARCHAR(32) COMMENT '输液速度',
    skin_test_result VARCHAR(16) COMMENT '皮试结果: NEGATIVE/POSITIVE',
    remark          VARCHAR(256),
    adverse_reaction VARCHAR(512) COMMENT '不良反应',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_visit (visit_id),
    INDEX idx_nurse_date (nurse_id, create_time)
);
```

---

## 2.6 急诊管理

### 功能详述

| 功能 | 说明 |
|---|---|
| 急诊挂号 | 急诊专用挂号通道，支持先诊疗后挂号 |
| 急诊分诊（预检分级） | 按四级分诊标准（濒危/危重/急症/非急症）自动推荐分级 |
| 急诊留观 | 留观患者管理、留观床位管理 |
| 急诊抢救 | 抢救记录、时间节点记录（到达/分诊/用药/检查等） |
| 急诊绿色通道 | 绿色通道标记，优先检查/检验/收费 |
| 急诊转归 | 转住院/转门诊/离院/转院/死亡 |

### 急诊预检分级标准

```
Ⅰ级（濒危）：立即救治（心脏骤停、严重呼吸困难、大出血等）
Ⅱ级（危重）：10分钟内救治（胸痛、意识障碍、严重创伤等）
Ⅲ级（急症）：30分钟内就诊（高热、腹痛、骨折等）
Ⅳ级（非急症）：可等待（轻微外伤、感冒等）
```

```sql
-- 急诊分诊记录
CREATE TABLE er_triage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    visit_id        BIGINT,
    reg_id          BIGINT,
    arrival_time    DATETIME NOT NULL COMMENT '到达时间',
    arrival_mode    VARCHAR(16) COMMENT 'AMBULANCE/SELF/OTHER',
    triage_level    TINYINT NOT NULL COMMENT '分诊级别 1-4',
    triage_basis    TEXT COMMENT '分诊依据',
    chief_complaint TEXT COMMENT '主诉',
    vital_signs     JSON COMMENT '生命体征(JSON): 体温/脉搏/呼吸/血压/血氧',
    consciousness   VARCHAR(16) COMMENT '意识状态',
    pain_score      INT COMMENT '疼痛评分',
    nurse_id        BIGINT NOT NULL COMMENT '分诊护士',
    nurse_name      VARCHAR(64),
    triage_time     DATETIME,
    status          VARCHAR(16) DEFAULT 'TRIAGED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_arrival (hospital_id, arrival_time)
);

-- 急诊抢救记录
CREATE TABLE er_rescue (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    visit_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    rescue_start_time DATETIME NOT NULL,
    rescue_end_time   DATETIME,
    diagnosis       VARCHAR(512),
    chief_doctor_id BIGINT,
    rescue_process  TEXT COMMENT '抢救经过',
    outcome         VARCHAR(32) COMMENT 'SUCCESS/DEAD/TRANSFER',
    vital_signs_timeline JSON COMMENT '生命体征时间线',
    medication_timeline  JSON COMMENT '用药时间线',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 急诊时间节点记录
CREATE TABLE er_time_node (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    visit_id        BIGINT NOT NULL,
    node_type       VARCHAR(32) NOT NULL COMMENT 'ARRIVAL/TRIAGE/FIRST_ECG/CT_TIME/DOOR_TO_NEEDLE/...',
    node_time       DATETIME NOT NULL,
    operator_id     BIGINT,
    remark          VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_visit (visit_id)
);
```

---

## 2.7 自助服务

| 功能 | 说明 |
|---|---|
| 自助挂号 | 选择科室/医生/时段，自助缴费挂号 |
| 自助缴费 | 待缴费项目展示，扫码支付 |
| 自助打印 | 检验报告、发票、费用清单自助打印 |
| 自助查询 | 费用查询、报告查询 |
| 设备管理 | 自助机注册、状态监控、远程重启 |

```sql
-- 自助机设备
CREATE TABLE op_kiosk_device (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    device_code     VARCHAR(32) NOT NULL,
    device_name     VARCHAR(64),
    device_type     VARCHAR(16) COMMENT 'REGISTRATION/PAYMENT/PRINT/QUERY',
    location        VARCHAR(128),
    ip_address      VARCHAR(64),
    status          VARCHAR(16) DEFAULT 'ONLINE' COMMENT 'ONLINE/OFFLINE/MAINTENANCE',
    last_heartbeat  DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_device (hospital_id, device_code)
);
```

---

# 三、住院业务

---

## 3.1 入院登记

### 功能详述

| 功能 | 说明 |
|---|---|
| 入院办理 | 患者信息确认、入院登记、分配床位 |
| 预交金收取 | 收取住院预交金，支持多渠道支付 |
| 医保登记 | 医保患者入院登记、医保类型确认 |
| 入院通知单 | 生成入院通知单（打印） |
| 腕带打印 | 打印患者腕带（含姓名/住院号/床号/二维码） |
| 入院评估 | 入院护理评估（压疮风险/跌倒风险/营养评估等） |

### 核心业务流程

```
门诊/急诊医生开具入院证
    ↓
住院处办理入院登记
    ↓
确认患者信息 → 选择科室/床位 → 收取预交金
    ↓
医保患者 → 医保登记（读卡/电子凭证）
    ↓
打印腕带 → 生成住院号 → 通知病区护士站
    ↓
病区护士接收 → 安排床位 → 入院护理评估
    ↓
住院医生接诊 → 开具入院医嘱
```

### 数据模型

```sql
-- 住院主记录
CREATE TABLE ip_admission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_no    VARCHAR(32) NOT NULL COMMENT '住院号',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64) NOT NULL,
    gender          VARCHAR(8),
    birth_date      DATE,
    age             INT,
    age_unit        VARCHAR(4),
    id_card         VARCHAR(32),
    phone           VARCHAR(16),
    address         VARCHAR(256),
    emergency_contact VARCHAR(64),
    emergency_phone VARCHAR(16),
    dept_id         BIGINT NOT NULL COMMENT '入院科室',
    dept_name       VARCHAR(128),
    bed_id          BIGINT COMMENT '床位ID',
    bed_no          VARCHAR(16),
    admit_diagnosis VARCHAR(512) COMMENT '入院诊断',
    admit_doctor_id BIGINT COMMENT '主治医师',
    admit_doctor_name VARCHAR(64),
    admit_date      DATETIME NOT NULL COMMENT '入院日期',
    admit_type      VARCHAR(16) COMMENT 'NORMAL/EMERGENCY/TRANSFER',
    referral_source VARCHAR(64) COMMENT '来源(门诊/急诊/转院)',
    insurance_type  VARCHAR(32) COMMENT '医保类型',
    insurance_no    VARCHAR(64) COMMENT '医保号',
    deposit_amount  DECIMAL(12,2) DEFAULT 0 COMMENT '预交金余额',
    total_cost      DECIMAL(12,2) DEFAULT 0 COMMENT '累计费用',
    status          VARCHAR(16) DEFAULT 'ADMITTED' COMMENT 'ADMITTED/TRANSFERRED/DISCHARGED/CANCELLED',
    discharge_date  DATETIME,
    discharge_type  VARCHAR(16) COMMENT 'NORMAL/TRANSFER/DEATH/ABSconding',
    discharge_diagnosis VARCHAR(512),
    hospitalization_days INT COMMENT '住院天数',
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_admission_no (hospital_id, admission_no),
    INDEX idx_patient (patient_id),
    INDEX idx_dept_status (dept_id, status)
);

-- 预交金记录
CREATE TABLE ip_deposit (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    deposit_no      VARCHAR(32) NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    pay_type        VARCHAR(16) NOT NULL COMMENT 'CASH/WECHAT/ALIPAY/CARD/TRANSFER',
    pay_time        DATETIME NOT NULL,
    receipt_no      VARCHAR(32) COMMENT '收据号',
    operator_id     BIGINT NOT NULL,
    operator_name   VARCHAR(64),
    status          TINYINT DEFAULT 1 COMMENT '1-有效 0-已退',
    remark          VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_deposit_no (hospital_id, deposit_no)
);

-- 住院床位变动记录
CREATE TABLE ip_bed_change (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    change_type     VARCHAR(16) NOT NULL COMMENT 'ADMIT/TRANSFER/TEMPORARY',
    from_dept_id    BIGINT,
    from_bed_id     BIGINT,
    to_dept_id      BIGINT NOT NULL,
    to_bed_id       BIGINT NOT NULL,
    change_time     DATETIME NOT NULL,
    reason          VARCHAR(256),
    operator_id     BIGINT NOT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 业务规则

- 住院号全局唯一，格式可配置（如 年份+流水号）
- 床位占用时不可再分配
- 预交金余额低于阈值时自动提醒（短信/站内信）
- 医保患者入院48小时内完成医保登记（超时提醒）
- 同一患者可有多次住院记录

---

## 3.2 住院医生工作站

### 功能详述

| 功能 | 说明 |
|---|---|
| 患者列表 | 在院患者列表、待办事项（待执行医嘱/待书写病历） |
| 医嘱开具 | 长期医嘱、临时医嘱（药品/检查/检验/护理/膳食） |
| 医嘱管理 | 医嘱修改、停止、取消、重整 |
| 病程记录 | 首次病程记录、日常病程、上级医师查房记录、阶段小结 |
| 手术申请 | 提交手术申请（关联术前讨论） |
| 会诊申请 | 发起科间/院内/院外会诊 |
| 转科申请 | 提交转科申请 |
| 出院申请 | 提交出院申请，生成出院小结 |
| 诊断管理 | 入院诊断、出院诊断、手术诊断 |
| 检查检验结果 | 查看检查检验报告 |

### 医嘱类型分类

```
长期医嘱（持续执行直到停止）:
  ├── 药品医嘱（长期用药）
  ├── 护理级别（特级/一级/二级/三级护理）
  ├── 膳食医嘱（普通/低盐/糖尿病饮食等）
  └── 治疗医嘱（持续性治疗）

临时医嘱（执行一次）:
  ├── 药品医嘱（临时用药/术前用药）
  ├── 检查医嘱（CT/MR/超声等）
  ├── 检验医嘱（血常规/生化等）
  ├── 手术医嘱
  ├── 会诊医嘱
  └── 护理操作（导尿/换药等）
```

### 数据模型

```sql
-- 住院医嘱
CREATE TABLE ip_order (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    order_no        VARCHAR(32) NOT NULL COMMENT '医嘱号',
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    order_type      VARCHAR(16) NOT NULL COMMENT 'LONG/TEMP' COMMENT '长期/临时',
    order_category  VARCHAR(32) NOT NULL COMMENT 'DRUG/EXAM/LAB/NURSING/DIET/TREATMENT/SURGERY/CONSULT',
    item_id         BIGINT COMMENT '关联项目ID',
    item_code       VARCHAR(32),
    item_name       VARCHAR(256) NOT NULL,
    specification   VARCHAR(128),
    quantity         DECIMAL(10,2),
    unit            VARCHAR(16),
    dosage          VARCHAR(32),
    dosage_unit     VARCHAR(16),
    frequency       VARCHAR(32) COMMENT '频次',
    frequency_code  VARCHAR(16) COMMENT '频次编码',
    route           VARCHAR(32) COMMENT '给药途径',
    route_code      VARCHAR(16),
    start_time      DATETIME COMMENT '开始时间',
    stop_time       DATETIME COMMENT '停止时间',
    exec_dept_id    BIGINT COMMENT '执行科室',
    urgency         TINYINT DEFAULT 0,
    doctor_id       BIGINT NOT NULL COMMENT '开嘱医生',
    doctor_name     VARCHAR(64),
    audit_nurse_id  BIGINT COMMENT '审核护士',
    audit_nurse_name VARCHAR(64),
    audit_time      DATETIME,
    order_status    VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/SUBMITTED/AUDITED/EXECUTING/COMPLETED/STOPPED/CANCELLED',
    stop_doctor_id  BIGINT,
    stop_time_actual DATETIME,
    stop_reason     VARCHAR(256),
    remark          VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_order_no (hospital_id, order_no),
    INDEX idx_admission (admission_id, order_status)
);

-- 医嘱执行记录
CREATE TABLE ip_order_exec (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    order_id        BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    exec_seq        INT DEFAULT 1 COMMENT '执行序号',
    exec_time       DATETIME COMMENT '计划执行时间',
    actual_exec_time DATETIME COMMENT '实际执行时间',
    exec_nurse_id   BIGINT,
    exec_nurse_name VARCHAR(64),
    exec_status     VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/EXECUTING/COMPLETED/SKIPPED',
    exec_remark     VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (order_id),
    INDEX idx_exec_time (exec_time, exec_status)
);

-- 病程记录
CREATE TABLE ip_medical_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    record_type     VARCHAR(32) NOT NULL COMMENT 'FIRST/DAILY/SUPERVISOR/STAGE/CONSULTATION/...',
    record_title    VARCHAR(256),
    record_content  TEXT NOT NULL,
    doctor_id       BIGINT NOT NULL,
    doctor_name     VARCHAR(64),
    record_time     DATETIME NOT NULL,
    sign_doctor_id  BIGINT COMMENT '审签医师',
    sign_time       DATETIME,
    status          VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/SIGNED/ARCHIVED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id, record_type)
);
```

### 业务规则

- 长期医嘱默认次日生效（可配置当日生效）
- 停止长期医嘱需注明停止原因
- 医嘱需护士审核后方可执行（可配置免审规则）
- 医嘱执行后不可修改，只能停止并重新开具
- 每日自动产生长期医嘱的执行记录
- 药品医嘱需通过合理用药审查

---

## 3.3 住院护士工作站

| 功能 | 说明 |
|---|---|
| 医嘱审核 | 审核医生开具的医嘱（合理性/可执行性） |
| 医嘱执行 | 按医嘱执行护理操作，扫码确认 |
| 护理记录 | 护理记录单书写（病情观察/护理措施/效果评价） |
| 体征采集 | 体温、脉搏、呼吸、血压、血氧、体重、出入量 |
| 体温单 | 自动生成体温单（图形化展示） |
| 交班报告 | 自动生成交班报告（新入/手术/病危/特殊患者） |
| 巡视记录 | 病房巡视记录 |
| 护理评估 | 压疮评估(Braden)、跌倒评估(Morse)、营养评估、疼痛评估 |
| 护理计划 | 护理问题→护理措施→效果评价的闭环管理 |

```sql
-- 体征记录
CREATE TABLE ip_vital_signs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    record_time     DATETIME NOT NULL,
    temperature     DECIMAL(4,1) COMMENT '体温(℃)',
    pulse           INT COMMENT '脉搏(次/分)',
    heart_rate      INT COMMENT '心率',
    respiration     INT COMMENT '呼吸(次/分)',
    sbp             INT COMMENT '收缩压(mmHg)',
    dbp             INT COMMENT '舒张压(mmHg)',
    spo2            INT COMMENT '血氧饱和度(%)',
    weight          DECIMAL(5,2) COMMENT '体重(kg)',
    height          DECIMAL(5,1) COMMENT '身高(cm)',
    intake_oral     DECIMAL(8,1) COMMENT '入量-口服(ml)',
    intake_iv       DECIMAL(8,1) COMMENT '入量-静脉(ml)',
    intake_other    DECIMAL(8,1) COMMENT '入量-其他(ml)',
    output_urine    DECIMAL(8,1) COMMENT '出量-尿(ml)',
    output_stool    DECIMAL(8,1) COMMENT '出量-便(ml)',
    output_other    DECIMAL(8,1) COMMENT '出量-其他(ml)',
    stool_count     DECIMAL(4,1) COMMENT '大便次数',
    pain_score      INT COMMENT '疼痛评分',
    consciousness   VARCHAR(16) COMMENT '意识状态',
    nurse_id        BIGINT,
    nurse_name      VARCHAR(64),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admission_time (admission_id, record_time)
);

-- 护理记录
CREATE TABLE ip_nursing_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    record_type     VARCHAR(32) COMMENT 'GENERAL/CRITICAL/SPECIAL/POSTOP',
    record_time     DATETIME NOT NULL,
    nursing_problem TEXT COMMENT '护理问题',
    nursing_measure TEXT COMMENT '护理措施',
    effect_eval     TEXT COMMENT '效果评价',
    nurse_id        BIGINT NOT NULL,
    nurse_name      VARCHAR(64),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id, record_time)
);
```

---

## 3.4 手术管理

### 功能详述

| 功能 | 说明 |
|---|---|
| 手术申请 | 医生提交手术申请（手术名称/术式/日期/台次） |
| 术前讨论 | 术前讨论记录、多学科讨论 |
| 手术排台 | 手术室排班、手术台次安排 |
| 术前准备 | 术前医嘱、备血、禁食禁水提醒 |
| 手术安全核查 | WHO手术安全核查表（麻醉前/切皮前/离开前） |
| 手术记录 | 手术经过、术中出血量、标本处理 |
| 麻醉记录 | 麻醉方式、麻醉用药、生命体征曲线 |
| 术后管理 | 术后医嘱、术后首次病程、术后随访 |
| 手术室管理 | 手术间状态管理、设备管理 |

### 核心业务流程

```
医生提交手术申请
    ↓
科主任审批 → 麻醉科评估 → 手术室排台
    ↓
术前准备（术前讨论/备血/术前医嘱）
    ↓
手术当日：患者接入手术室
    ↓
手术安全核查（麻醉前）→ 麻醉 → 安全核查（切皮前）→ 手术
    ↓
手术完成 → 安全核查（离开前）→ 送复苏室/病房
    ↓
术后记录 → 病理标本送检 → 术后医嘱
```

### 数据模型

```sql
-- 手术申请
CREATE TABLE ip_surgery_apply (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    apply_no        VARCHAR(32) NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    diagnosis       VARCHAR(512),
    surgery_name    VARCHAR(256) NOT NULL COMMENT '手术名称',
    surgery_code    VARCHAR(32) COMMENT 'ICD-9-CM-3',
    surgery_level   VARCHAR(16) COMMENT '手术级别(一/二/三/四)',
    surgery_type    VARCHAR(16) COMMENT '择期/急诊',
    plan_date       DATE COMMENT '拟手术日期',
    plan_time       TIME COMMENT '拟手术时间',
    estimated_duration INT COMMENT '预计时长(分钟)',
    surgeon_id      BIGINT NOT NULL COMMENT '主刀',
    surgeon_name    VARCHAR(64),
    assistant_ids   VARCHAR(128) COMMENT '助手ID列表',
    anesthesiologist_id BIGINT COMMENT '麻醉医师',
    anesthesiologist_name VARCHAR(64),
    anesthesia_type VARCHAR(32) COMMENT '麻醉方式',
    surgical_site   VARCHAR(128) COMMENT '手术部位',
    side            VARCHAR(16) COMMENT 'LEFT/RIGHT/BILATERAL',
    special_requirements TEXT COMMENT '特殊要求',
    apply_status    VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/SCHEDULED/COMPLETED/CANCELLED',
    approve_time    DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_apply_no (hospital_id, apply_no)
);

-- 手术排台
CREATE TABLE ip_surgery_schedule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    surgery_apply_id BIGINT NOT NULL,
    surgery_room_id BIGINT NOT NULL COMMENT '手术间',
    surgery_date    DATE NOT NULL,
    seq_no          INT COMMENT '台次',
    plan_start_time TIME,
    plan_end_time   TIME,
    actual_start_time DATETIME,
    actual_end_time DATETIME,
    status          VARCHAR(16) DEFAULT 'SCHEDULED' COMMENT 'SCHEDULED/IN_PROGRESS/COMPLETED/CANCELLED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 手术间
CREATE TABLE ip_surgery_room (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    room_no         VARCHAR(16) NOT NULL,
    room_name       VARCHAR(64),
    room_type       VARCHAR(32) COMMENT '普通/洁净/杂交/介入',
    location        VARCHAR(128),
    equipment       JSON COMMENT '设备清单',
    status          VARCHAR(16) DEFAULT 'IDLE' COMMENT 'IDLE/IN_USE/MAINTENANCE',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 手术安全核查记录
CREATE TABLE ip_surgery_checklist (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    surgery_id      BIGINT NOT NULL COMMENT '手术记录ID',
    check_phase     VARCHAR(32) NOT NULL COMMENT 'BEFORE_ANESTHESIA/BEFORE_INCISION/BEFORE_CLOSURE',
    check_items     JSON NOT NULL COMMENT '核查项目及结果',
    checked_by      BIGINT NOT NULL,
    checked_time    DATETIME NOT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 手术记录
CREATE TABLE ip_surgery_record (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    surgery_apply_id BIGINT,
    surgery_date    DATE NOT NULL,
    surgery_name    VARCHAR(256),
    surgery_code    VARCHAR(32),
    surgeon_id      BIGINT,
    surgeon_name    VARCHAR(64),
    assistant_names VARCHAR(256),
    anesthesiologist_id BIGINT,
    anesthesiologist_name VARCHAR(64),
    anesthetist_names VARCHAR(256),
    nurse_names     VARCHAR(256) COMMENT '器械护士/巡回护士',
    anesthesia_type VARCHAR(32),
    surgery_start_time DATETIME,
    surgery_end_time DATETIME,
    skin_cut_time   DATETIME COMMENT '切皮时间',
    skin_close_time DATETIME COMMENT '缝皮时间',
    intraop_blood_loss INT COMMENT '术中出血(ml)',
    blood_transfusion INT COMMENT '输血(ml)',
    specimen_sent   TINYINT DEFAULT 0 COMMENT '是否送病理',
    specimen_desc   VARCHAR(512) COMMENT '标本描述',
    surgery_process TEXT COMMENT '手术经过',
    intraop_findings TEXT COMMENT '术中所见',
    complications   VARCHAR(512) COMMENT '并发症',
    status          VARCHAR(16) DEFAULT 'DRAFT',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id)
);
```

---

## 3.5 会诊管理

| 功能 | 说明 |
|---|---|
| 会诊申请 | 科间会诊/急会诊/全院会诊/MDT/院外会诊 |
| 会诊审批 | 科主任审批（普通会诊），医务科审批（全院/院外） |
| 会诊安排 | 指定会诊医师、会诊时间、会诊地点 |
| 会诊记录 | 会诊意见记录、会诊医师签名 |
| 会诊时限 | 普通会诊48小时内完成，急会诊10分钟内到场 |

```sql
CREATE TABLE ip_consultation (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    consult_no      VARCHAR(32) NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    consult_type    VARCHAR(16) NOT NULL COMMENT 'NORMAL/URGENT/HOSPITAL/MDT/EXTERNAL',
    apply_dept_id   BIGINT NOT NULL,
    apply_doctor_id BIGINT NOT NULL,
    apply_reason    TEXT NOT NULL COMMENT '会诊原因/目的',
    clinical_summary TEXT COMMENT '病情摘要',
    target_dept_id  BIGINT COMMENT '会诊科室',
    target_doctor_id BIGINT COMMENT '会诊医师',
    consult_time    DATETIME COMMENT '会诊时间',
    consult_place   VARCHAR(128) COMMENT '会诊地点',
    consult_opinion TEXT COMMENT '会诊意见',
    consult_doctor_id BIGINT COMMENT '实际会诊医师',
    consult_sign_time DATETIME COMMENT '会诊签名时间',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/IN_PROGRESS/COMPLETED',
    apply_time      DATETIME,
    deadline_time   DATETIME COMMENT '会诊截止时间',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_consult_no (hospital_id, consult_no)
);
```

---

## 3.6 出院管理

| 功能 | 说明 |
|---|---|
| 出院申请 | 医生提交出院申请 |
| 出院小结 | 自动生成出院小结（诊断/治疗经过/出院带药/注意事项） |
| 出院医嘱 | 出院带药、出院指导 |
| 出院结算 | 费用汇总、医保结算、个人支付 |
| 出院召回 | 出院后需召回修改（如诊断变更） |
| 随访计划 | 设置出院随访计划 |

```sql
CREATE TABLE ip_discharge (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    discharge_date  DATETIME NOT NULL,
    discharge_type  VARCHAR(16) NOT NULL COMMENT 'NORMAL/TRANSFER/DEATH/ABSconding/SELF',
    discharge_dept_id BIGINT,
    discharge_bed_id BIGINT,
    discharge_diagnosis VARCHAR(1024) COMMENT '出院诊断(JSON)',
    treatment_summary TEXT COMMENT '诊疗经过',
    discharge_condition VARCHAR(512) COMMENT '出院时情况',
    discharge_orders TEXT COMMENT '出院医嘱',
    discharge_medications JSON COMMENT '出院带药',
    follow_up_plan  JSON COMMENT '随访计划',
    follow_up_date  DATE COMMENT '复诊日期',
    attending_doctor_id BIGINT,
    attending_doctor_name VARCHAR(64),
    director_doctor_id BIGINT COMMENT '科主任',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/SETTLED/COMPLETED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

---

# 四、电子病历（EMR）

---

## 4.1 病历编辑器

### 功能详述

这是 HIS 中**技术难度最高**的组件之一。

| 功能 | 说明 |
|---|---|
| 富文本编辑 | 基于富文本编辑器（推荐基于 ProseMirror/Quill 自研） |
| 结构化元素 | 在富文本中嵌入结构化数据元素（下拉选择/日期/数值/单选） |
| 医学术语绑定 | 结构化元素绑定医学术语（诊断/手术/症状等） |
| 模板引擎 | 支持病历模板的创建、编辑、应用 |
| 片段复用 | 常用文本片段快速插入 |
| 历史引用 | 引用历史病历内容 |
| 三级审签 | 住院医师→主治医师→主任医师逐级审签 |
| 痕迹保留 | 修改痕迹保留（红字标记删除/蓝字标记新增） |
| 电子签名 | CA数字签名或电子签章 |
| 打印 | 病历打印、套打 |

### 数据模型

```sql
-- 病历文档
CREATE TABLE emr_document (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    doc_type        VARCHAR(32) NOT NULL COMMENT '文档类型: FIRST_DAILY/DAILY/SUPERVISOR/STAGE/SUMMARY/...',
    doc_title       VARCHAR(256),
    doc_content     LONGTEXT COMMENT '病历内容(HTML)',
    structured_data JSON COMMENT '结构化数据',
    template_id     BIGINT COMMENT '使用的模板',
    author_id       BIGINT NOT NULL COMMENT '作者',
    author_name     VARCHAR(64),
    author_title    VARCHAR(32) COMMENT '作者职称',
    write_time      DATETIME NOT NULL COMMENT '书写时间',
    sign_level      TINYINT DEFAULT 0 COMMENT '签名级别: 0-未签 1-住院医签名 2-主治签名 3-主任签名',
    sign_doctor_id  BIGINT,
    sign_doctor_name VARCHAR(64),
    sign_time       DATETIME,
    status          VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/SIGNED/ARCHIVED/LOCKED',
    version         INT DEFAULT 1,
    is_supplement   TINYINT DEFAULT 0 COMMENT '是否补充病历',
    supplement_of   BIGINT COMMENT '补充哪份病历',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id, doc_type)
);

-- 病历修改痕迹
CREATE TABLE emr_revision (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    doc_id          BIGINT NOT NULL,
    revision_content TEXT COMMENT '修改后完整内容',
    revision_diff   TEXT COMMENT '变更差异',
    revised_by      BIGINT NOT NULL,
    revised_by_name VARCHAR(64),
    revised_time    DATETIME NOT NULL,
    revision_reason VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_doc (doc_id)
);

-- 病历模板
CREATE TABLE emr_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT DEFAULT 0 COMMENT '0=全院模板',
    dept_id         BIGINT DEFAULT 0 COMMENT '0=非科室模板',
    doctor_id       BIGINT DEFAULT 0 COMMENT '0=非个人模板',
    template_code   VARCHAR(64) NOT NULL,
    template_name   VARCHAR(128) NOT NULL,
    doc_type        VARCHAR(32) NOT NULL,
    template_content TEXT NOT NULL COMMENT '模板HTML',
    structured_elements JSON COMMENT '结构化元素定义',
    sort_order      INT DEFAULT 0,
    is_default      TINYINT DEFAULT 0,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (template_code)
);
```

---

## 4.2 病历质控

| 功能 | 说明 |
|---|---|
| 时限质控 | 各类病历的书写时限要求（如入院24h内完成入院记录） |
| 内容质控 | 必填项检查、逻辑一致性检查 |
| 自动质控 | 系统自动检查并提醒（如首次病程8小时内完成） |
| 人工质控 | 质控员人工抽查评分 |
| 质控评分 | 按评分标准自动计算病历得分 |
| 缺陷管理 | 缺陷记录、缺陷整改、整改确认 |
| 质控统计 | 科室/医生维度的质控统计报表 |

### 质控规则示例

```
入院记录：入院24小时内完成
首次病程记录：入院8小时内完成
日常病程记录：病危每天至少1次，病重至少3天1次，一般至少3天1次
上级医师首次查房：入院48小时内
手术记录：术后24小时内
出院记录：出院24小时内
死亡记录：死亡24小时内
```

```sql
CREATE TABLE emr_quality_rule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    rule_name       VARCHAR(128) NOT NULL,
    rule_type       VARCHAR(16) NOT NULL COMMENT 'TIME_LIMIT/CONTENT/LOGIC',
    doc_type        VARCHAR(32) COMMENT '适用文档类型',
    condition_expr  TEXT COMMENT '条件表达式',
    time_limit_hours INT COMMENT '时限(小时)',
    time_limit_base VARCHAR(32) COMMENT '时限基准: ADMISSION/SURGERY/DEATH/DISCHARGE',
    score_deduct    DECIMAL(5,2) COMMENT '扣分值',
    severity        VARCHAR(16) COMMENT 'MAJOR/MINOR',
    description     VARCHAR(512),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE emr_quality_check (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    doc_id          BIGINT,
    rule_id         BIGINT NOT NULL,
    check_type      VARCHAR(16) COMMENT 'AUTO/MANUAL',
    check_result    VARCHAR(16) COMMENT 'PASS/FAIL',
    defect_desc     VARCHAR(512),
    score_deducted  DECIMAL(5,2),
    check_time      DATETIME,
    checker_id      BIGINT,
    fix_status      VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/FIXED/CONFIRMED',
    fix_time        DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id)
);
```

---

# 五、药品管理

---

## 5.1 药库管理

### 功能详述

| 功能 | 说明 |
|---|---|
| 药品入库 | 采购入库、退货入库、调拨入库 |
| 药品出库 | 调拨出库（到各药房）、报损出库、退货出库 |
| 库存管理 | 实时库存查询、库存上下限预警 |
| 盘点管理 | 定期盘点、盘点差异处理 |
| 调价管理 | 药品调价、调价单管理、价格生效时间 |
| 效期管理 | 近效期预警（6个月/3个月/1个月）、过期自动锁定 |
| 批号管理 | 按批号追踪药品流向 |
| 特殊药品管控 | 毒麻精放药品的专账管理、双人复核 |

### 数据模型

```sql
-- 药品库存
CREATE TABLE drug_stock (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    warehouse_id    BIGINT NOT NULL COMMENT '仓库/药房ID',
    warehouse_type  VARCHAR(16) NOT NULL COMMENT 'STORE/PHARMACY_OUT/PHARMACY_IN/PHARMACY_CHINESE',
    drug_id         BIGINT NOT NULL COMMENT '药品ID',
    drug_code       VARCHAR(32) NOT NULL,
    drug_name       VARCHAR(256) NOT NULL,
    specification   VARCHAR(128),
    manufacturer    VARCHAR(128),
    batch_no        VARCHAR(64) COMMENT '批号',
    expiry_date     DATE COMMENT '有效期',
    unit            VARCHAR(16),
    quantity        DECIMAL(12,2) DEFAULT 0 COMMENT '库存数量',
    frozen_quantity DECIMAL(12,2) DEFAULT 0 COMMENT '冻结数量(待发药)',
    available_quantity DECIMAL(12,2) GENERATED ALWAYS AS (quantity - frozen_quantity) STORED,
    unit_cost       DECIMAL(12,4) COMMENT '单位成本',
    retail_price    DECIMAL(12,4) COMMENT '零售价',
    location        VARCHAR(64) COMMENT '货位',
    last_in_date    DATE COMMENT '最近入库日期',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_warehouse_drug (warehouse_id, drug_id),
    INDEX idx_expiry (expiry_date)
);

-- 药品入库单
CREATE TABLE drug_stock_in (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    stock_in_no     VARCHAR(32) NOT NULL,
    warehouse_id    BIGINT NOT NULL,
    in_type         VARCHAR(16) NOT NULL COMMENT 'PURCHASE/RETURN/TRANSFER/ADJUST',
    supplier_id     BIGINT COMMENT '供应商',
    purchase_order_id BIGINT COMMENT '采购单',
    total_amount    DECIMAL(12,2),
    item_count      INT,
    status          VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/AUDITED/COMPLETED',
    operator_id     BIGINT,
    auditor_id      BIGINT,
    audit_time      DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stock_in_no (hospital_id, stock_in_no)
);

CREATE TABLE drug_stock_in_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    stock_in_id     BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    drug_code       VARCHAR(32),
    drug_name       VARCHAR(256),
    specification   VARCHAR(128),
    batch_no        VARCHAR(64),
    expiry_date     DATE,
    manufacturer    VARCHAR(128),
    approval_no     VARCHAR(64),
    unit            VARCHAR(16),
    quantity        DECIMAL(12,2) NOT NULL,
    unit_cost       DECIMAL(12,4),
    retail_price    DECIMAL(12,4),
    total_cost      DECIMAL(12,2),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_stock_in (stock_in_id)
);

-- 药品出库单
CREATE TABLE drug_stock_out (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    stock_out_no    VARCHAR(32) NOT NULL,
    from_warehouse_id BIGINT NOT NULL,
    to_warehouse_id BIGINT COMMENT '调拨目标仓库',
    out_type        VARCHAR(16) NOT NULL COMMENT 'TRANSFER/DAMAGE/RETURN/SUPPLY',
    total_amount    DECIMAL(12,2),
    status          VARCHAR(16) DEFAULT 'DRAFT',
    operator_id     BIGINT,
    auditor_id      BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_stock_out_no (hospital_id, stock_out_no)
);

-- 药品盘点
CREATE TABLE drug_stock_check (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    check_no        VARCHAR(32) NOT NULL,
    warehouse_id    BIGINT NOT NULL,
    check_date      DATE NOT NULL,
    check_type      VARCHAR(16) COMMENT 'FULL/PARTIAL/RANDOM',
    status          VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/CHECKING/COMPLETED/ADJUSTED',
    total_profit    DECIMAL(12,2) COMMENT '盘盈金额',
    total_loss      DECIMAL(12,2) COMMENT '盘亏金额',
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE drug_stock_check_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    check_id        BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    batch_no        VARCHAR(64),
    system_quantity DECIMAL(12,2) COMMENT '系统库存',
    actual_quantity DECIMAL(12,2) COMMENT '实际库存',
    diff_quantity   DECIMAL(12,2) COMMENT '差异数量',
    diff_reason     VARCHAR(256),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_check (check_id)
);
```

### 业务规则

- 效期不足6个月的药品标记近效期
- 效期不足3个月的药品禁止出库（可配置）
- 毒麻药品必须双人复核入库/出库
- 药品库存不可为负
- 调价生效前需审批，生效后自动更新所有相关库存的零售价
- 盘点差异超过阈值需科主任审批

---

## 5.2 药品采购

| 功能 | 说明 |
|---|---|
| 采购计划 | 基于库存上下限自动生成采购计划，人工调整 |
| 供应商管理 | 供应商资质、联系方式、供货记录 |
| 采购订单 | 创建采购订单、订单审批 |
| 到货验收 | 到货后核对品名/批号/数量/效期，质量验收 |
| 退货管理 | 质量问题退货、近效期退货 |

```sql
-- 采购计划
CREATE TABLE drug_purchase_plan (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    plan_no         VARCHAR(32) NOT NULL,
    plan_date       DATE NOT NULL,
    plan_type       VARCHAR(16) COMMENT 'AUTO/MANUAL',
    status          VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/APPROVED/ORDERED/COMPLETED',
    total_amount    DECIMAL(12,2),
    operator_id     BIGINT,
    approver_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_plan_no (hospital_id, plan_no)
);

CREATE TABLE drug_purchase_plan_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    plan_id         BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    current_stock   DECIMAL(12,2) COMMENT '当前库存',
    min_stock       DECIMAL(12,2) COMMENT '库存下限',
    max_stock       DECIMAL(12,2) COMMENT '库存上限',
    suggest_quantity DECIMAL(12,2) COMMENT '建议采购量',
    plan_quantity   DECIMAL(12,2) COMMENT '计划采购量',
    unit_price      DECIMAL(12,4),
    supplier_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_plan (plan_id)
);

-- 供应商
CREATE TABLE drug_supplier (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    supplier_code   VARCHAR(32) NOT NULL,
    supplier_name   VARCHAR(256) NOT NULL,
    contact_person  VARCHAR(64),
    contact_phone   VARCHAR(32),
    address         VARCHAR(256),
    license_no      VARCHAR(64) COMMENT '经营许可证号',
    license_expiry  DATE COMMENT '许可证有效期',
    gmp_cert        VARCHAR(64) COMMENT 'GMP证书',
    bank_account    VARCHAR(64),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, supplier_code)
);
```

---

## 5.3 门诊药房 / 住院药房

| 功能 | 说明 |
|---|---|
| 处方接收 | 接收已收费处方，进入配药队列 |
| 配药（调配） | 药师按处方拣药、核对 |
| 发药 | 患者取药时核对、确认发药 |
| 退药 | 患者退药申请、退药审核、药品回库 |
| 住院摆药 | 按医嘱生成摆药单（单剂量/整包装） |
| 用药交代 | 打印用药指导单 |
| 处方审核 | 药师审核处方合理性 |

```sql
-- 调配发药记录
CREATE TABLE drug_dispensing (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    dispensing_no   VARCHAR(32) NOT NULL,
    pharmacy_id     BIGINT NOT NULL COMMENT '药房ID',
    presc_id        BIGINT NOT NULL COMMENT '处方ID',
    presc_no        VARCHAR(32),
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    presc_type      VARCHAR(16),
    total_amount    DECIMAL(12,2),
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/DISPENSING/DISPENSED/CANCELLED',
    pharmacist_id   BIGINT COMMENT '调配药师',
    pharmacist_name VARCHAR(64),
    dispensing_time DATETIME COMMENT '调配时间',
    deliver_id      BIGINT COMMENT '发药药师',
    deliver_name    VARCHAR(64),
    deliver_time    DATETIME COMMENT '发药时间',
    window_no       VARCHAR(16) COMMENT '发药窗口',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_dispensing_no (hospital_id, dispensing_no),
    INDEX idx_presc (presc_id),
    INDEX idx_patient (patient_id)
);

-- 调配发药明细
CREATE TABLE drug_dispensing_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    dispensing_id   BIGINT NOT NULL,
    presc_item_id   BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    drug_code       VARCHAR(32),
    drug_name       VARCHAR(256),
    specification   VARCHAR(128),
    batch_no        VARCHAR(64),
    unit            VARCHAR(16),
    quantity        DECIMAL(10,2),
    dispensed_quantity DECIMAL(10,2) COMMENT '实发数量',
    unit_price      DECIMAL(12,4),
    amount          DECIMAL(12,2),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_dispensing (dispensing_id)
);

-- 退药记录
CREATE TABLE drug_return (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    return_no       VARCHAR(32) NOT NULL,
    pharmacy_id     BIGINT NOT NULL,
    presc_id        BIGINT,
    admission_id    BIGINT COMMENT '住院ID(住院退药)',
    patient_id      BIGINT NOT NULL,
    return_reason   VARCHAR(256),
    total_amount    DECIMAL(12,2),
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/AUDITED/COMPLETED/REJECTED',
    auditor_id      BIGINT,
    audit_time      DATETIME,
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_return_no (hospital_id, return_no)
);
```

---

## 5.4 合理用药审查

| 功能 | 说明 |
|---|---|
| 药物相互作用审查 | 检测处方中药物间的相互作用 |
| 配伍禁忌审查 | 注射液配伍禁忌检查 |
| 过敏审查 | 基于患者过敏史审查 |
| 剂量审查 | 单次剂量、日剂量、疗程剂量范围检查 |
| 特殊人群审查 | 儿童/孕妇/老人/肝肾功能不全患者的用药警示 |
| 抗菌药物分级 | 按分级管理规定审查抗菌药物处方权限 |
| 审查结果 | 通过/警示/拦截，医生需对警示项确认理由 |

```sql
-- 合理用药审查结果
CREATE TABLE drug_rational_check (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    presc_id        BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    check_type      VARCHAR(32) NOT NULL COMMENT 'INTERACTION/COMPATIBILITY/ALLERGY/DOSE/SPECIAL_POPULATION/ANTIBIOTIC_LEVEL',
    severity        VARCHAR(16) NOT NULL COMMENT 'INFO/WARNING/CONTRAINDICATED',
    drug_a          VARCHAR(256) COMMENT '药品A',
    drug_b          VARCHAR(256) COMMENT '药品B(相互作用用)',
    check_result    VARCHAR(512) NOT NULL COMMENT '审查结果描述',
    reference       VARCHAR(512) COMMENT '参考来源',
    doctor_confirm  VARCHAR(16) COMMENT 'CONFIRMED/OVERRIDDEN',
    doctor_reason   VARCHAR(256) COMMENT '医生确认理由',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_presc (presc_id)
);
```

---

## 5.5 特殊药品管理

| 功能 | 说明 |
|---|---|
| 专账管理 | 毒麻精放药品独立账册 |
| 双人复核 | 入库/出库/盘点双人操作 |
| 处方限制 | 毒麻药品处方限量、专用处方 |
| 使用登记 | 逐次使用登记、空安瓿回收 |
| 库存日报 | 每日库存盘点 |

---

# 六、收费与财务管理

---

## 6.1 门诊收费

### 功能详述

| 功能 | 说明 |
|---|---|
| 收费 | 读取处方/检查/检验申请，按项目计费 |
| 退费 | 部分退费/全额退费，退费审批 |
| 医保结算 | 医保患者实时结算（统筹/个账/自费部分） |
| 支付方式 | 现金/微信/支付宝/银联/医保电子凭证/混合支付 |
| 发票管理 | 电子发票开具、纸质发票打印、发票作废 |
| 费用查询 | 患者费用明细查询 |

### 核心业务流程

```
医生开具处方/检查/检验申请
    ↓
收费窗口/自助机读取待缴费项目
    ↓
计算费用（医保患者计算报销比例）
    ↓
患者确认 → 选择支付方式 → 支付
    ↓
支付成功 → 更新处方状态 → 扣减医保额度
    ↓
开具发票 → 打印凭条
```

### 数据模型

```sql
-- 收费单
CREATE TABLE fee_bill (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    bill_no         VARCHAR(32) NOT NULL COMMENT '收费单号',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    bill_type       VARCHAR(16) NOT NULL COMMENT 'OUTPATIENT/INPATIENT/DEPOSIT',
    visit_id        BIGINT COMMENT '门诊就诊ID',
    admission_id    BIGINT COMMENT '住院ID',
    reg_id          BIGINT COMMENT '挂号ID',
    total_amount    DECIMAL(12,2) NOT NULL COMMENT '总金额',
    insurance_amount DECIMAL(12,2) DEFAULT 0 COMMENT '医保支付',
    fund_amount     DECIMAL(12,2) DEFAULT 0 COMMENT '统筹支付',
    personal_account DECIMAL(12,2) DEFAULT 0 COMMENT '个账支付',
    self_pay_amount DECIMAL(12,2) DEFAULT 0 COMMENT '自费金额',
    discount_amount DECIMAL(12,2) DEFAULT 0 COMMENT '优惠金额',
    actual_amount   DECIMAL(12,2) NOT NULL COMMENT '实收金额',
    pay_type        VARCHAR(16) NOT NULL COMMENT '支付方式',
    pay_channel     VARCHAR(32) COMMENT '支付渠道',
    trade_no        VARCHAR(64) COMMENT '第三方交易号',
    invoice_no      VARCHAR(32) COMMENT '发票号',
    invoice_status  VARCHAR(16) DEFAULT 'NOT_ISSUED' COMMENT 'NOT_ISSUED/ISSUED/VOID',
    status          VARCHAR(16) DEFAULT 'PAID' COMMENT 'PENDING/PAID/REFUNDED/PARTIAL_REFUND',
    operator_id     BIGINT NOT NULL,
    operator_name   VARCHAR(64),
    pay_time        DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bill_no (hospital_id, bill_no),
    INDEX idx_patient (patient_id),
    INDEX idx_pay_time (pay_time)
);

-- 收费明细
CREATE TABLE fee_bill_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    bill_id         BIGINT NOT NULL,
    item_type       VARCHAR(16) NOT NULL COMMENT 'DRUG/EXAM/LAB/TREAT/BED/FEE',
    item_id         BIGINT NOT NULL,
    item_code       VARCHAR(32),
    item_name       VARCHAR(256) NOT NULL,
    specification   VARCHAR(128),
    unit            VARCHAR(16),
    unit_price      DECIMAL(12,4) NOT NULL,
    quantity        DECIMAL(10,2) NOT NULL,
    amount          DECIMAL(12,2) NOT NULL,
    insurance_type  VARCHAR(16) COMMENT '甲类/乙类/丙类',
    self_pay_ratio  DECIMAL(5,4) COMMENT '自费比例',
    source_type     VARCHAR(16) COMMENT '来源类型: PRESCRIPTION/ORDER',
    source_id       BIGINT COMMENT '来源ID',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bill (bill_id)
);

-- 退费记录
CREATE TABLE fee_refund (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    refund_no       VARCHAR(32) NOT NULL,
    bill_id         BIGINT NOT NULL COMMENT '原收费单',
    refund_amount   DECIMAL(12,2) NOT NULL,
    refund_reason   VARCHAR(256),
    refund_type     VARCHAR(16) COMMENT '原路退回/现金',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/COMPLETED/REJECTED',
    approver_id     BIGINT,
    approve_time    DATETIME,
    operator_id     BIGINT,
    refund_time     DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_refund_no (hospital_id, refund_no)
);
```

### 业务规则

- 已发药的处方不可退费（需先退药）
- 已执行的检查/检验不可退费
- 退费金额超过阈值需上级审批
- 医保退费需同步冲销医保结算
- 发票作废需在当日完成（可配置）
- 混合支付退费按原支付比例退回

---

## 6.2 住院收费

| 功能 | 说明 |
|---|---|
| 住院记账 | 住院期间的药品/检查/检验/治疗/床位等费用自动/手动记账 |
| 预交金管理 | 预交金收取、退还、余额查询 |
| 费用日清单 | 每日费用清单（可打印/推送） |
| 欠费管理 | 欠费预警、欠费停医嘱（可配置） |
| 出院结算 | 费用汇总、医保结算、多退少补 |
| 中途结算 | 住院中途结算（长期住院患者） |

```sql
-- 住院费用明细
CREATE TABLE ip_fee_detail (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    fee_date        DATE NOT NULL COMMENT '费用日期',
    item_type       VARCHAR(16) NOT NULL,
    item_id         BIGINT NOT NULL,
    item_code       VARCHAR(32),
    item_name       VARCHAR(256) NOT NULL,
    specification   VARCHAR(128),
    unit            VARCHAR(16),
    unit_price      DECIMAL(12,4),
    quantity        DECIMAL(10,2),
    amount          DECIMAL(12,2) NOT NULL,
    source_type     VARCHAR(16) COMMENT 'ORDER/MANUAL',
    source_id       BIGINT,
    order_id        BIGINT COMMENT '关联医嘱',
    exec_dept_id    BIGINT COMMENT '执行科室',
    insurance_type  VARCHAR(16),
    is_settled      TINYINT DEFAULT 0 COMMENT '是否已结算',
    settle_id       BIGINT COMMENT '结算单ID',
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_admission (admission_id, fee_date),
    INDEX idx_patient (patient_id)
);

-- 住院结算单
CREATE TABLE ip_settlement (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    settle_no       VARCHAR(32) NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    settle_type     VARCHAR(16) COMMENT 'DISCHARGE/INTERIM/DEATH',
    total_cost      DECIMAL(12,2) NOT NULL COMMENT '总费用',
    drug_cost       DECIMAL(12,2) DEFAULT 0 COMMENT '药品费',
    exam_cost       DECIMAL(12,2) DEFAULT 0 COMMENT '检查费',
    lab_cost        DECIMAL(12,2) DEFAULT 0 COMMENT '检验费',
    treatment_cost  DECIMAL(12,2) DEFAULT 0 COMMENT '治疗费',
    material_cost   DECIMAL(12,2) DEFAULT 0 COMMENT '材料费',
    bed_cost        DECIMAL(12,2) DEFAULT 0 COMMENT '床位费',
    nursing_cost    DECIMAL(12,2) DEFAULT 0 COMMENT '护理费',
    other_cost      DECIMAL(12,2) DEFAULT 0 COMMENT '其他费',
    insurance_amount DECIMAL(12,2) DEFAULT 0,
    fund_amount     DECIMAL(12,2) DEFAULT 0,
    personal_account DECIMAL(12,2) DEFAULT 0,
    self_pay_amount DECIMAL(12,2) DEFAULT 0,
    deposit_total   DECIMAL(12,2) DEFAULT 0 COMMENT '预交金总额',
    refund_amount   DECIMAL(12,2) DEFAULT 0 COMMENT '退金额',
    supplement_amount DECIMAL(12,2) DEFAULT 0 COMMENT '补缴金额',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/SETTLED/CANCELLED',
    settle_time     DATETIME,
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_settle_no (hospital_id, settle_no)
);
```

---

## 6.3 票据管理

| 功能 | 说明 |
|---|---|
| 电子发票 | 对接财政电子发票系统，自动开具 |
| 纸质发票 | 发票号段管理、领用、核销 |
| 发票作废 | 当日作废、跨月红冲 |
| 汇总报表 | 按日/月/科室汇总发票数据 |

```sql
CREATE TABLE fee_invoice (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    invoice_no      VARCHAR(32) NOT NULL COMMENT '发票号',
    invoice_code    VARCHAR(32) COMMENT '发票代码',
    invoice_type    VARCHAR(16) COMMENT 'ELECTRONIC/PAPER',
    bill_id         BIGINT COMMENT '关联收费单',
    settle_id       BIGINT COMMENT '关联结算单',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    amount          DECIMAL(12,2) NOT NULL,
    insurance_amount DECIMAL(12,2) DEFAULT 0,
    self_pay_amount DECIMAL(12,2) DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'NORMAL' COMMENT 'NORMAL/VOID/RED',
    void_time       DATETIME,
    void_reason     VARCHAR(256),
    print_count     INT DEFAULT 0,
    electronic_url  VARCHAR(512) COMMENT '电子发票URL',
    operator_id     BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_invoice (hospital_id, invoice_no)
);
```

---

# 七、医技科室

---

## 7.1 检验管理（LIS）

### 功能详述

| 功能 | 说明 |
|---|---|
| 检验申请接收 | 接收门诊/住院的检验申请 |
| 条码生成 | 生成标本条码，贴于试管 |
| 标本采集 | 扫码确认采集时间、采集人 |
| 标本接收 | 实验室接收标本，确认标本质量 |
| 标本拒收 | 标本不合格时拒收并通知临床 |
| 结果录入 | 手工录入/仪器自动采集检验结果 |
| 结果审核 | 检验师审核结果，异常结果复核 |
| 报告发布 | 审核通过后发布报告 |
| 危急值管理 | 超出危急值范围的结果自动预警 |
| 质控管理 | 室内质控（IQC）、室间质评（EQA） |
| 微生物管理 | 细菌培养、药敏试验 |
| 标本追踪 | 全流程标本状态追踪 |

### 核心业务流程

```
医生开具检验申请 → 收费
    ↓
护士站/采血室：扫码确认 → 打印条码 → 采集标本
    ↓
标本运送 → 实验室接收 → 标本分检
    ↓
仪器检测/手工检测 → 结果录入
    ↓
结果审核（正常→直接审核/异常→复核）
    ↓
报告发布 → 通知临床 → 患者可查
    ↓
(如有危急值) → 立即电话通知临床 → 记录通知时间
```

### 数据模型

```sql
-- 检验申请
CREATE TABLE lab_order (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    order_no        VARCHAR(32) NOT NULL,
    visit_id        BIGINT COMMENT '门诊ID',
    admission_id    BIGINT COMMENT '住院ID',
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    gender          VARCHAR(8),
    age             INT,
    age_unit        VARCHAR(4),
    bed_no          VARCHAR(16) COMMENT '床号(住院)',
    dept_id         BIGINT,
    dept_name       VARCHAR(128),
    doctor_id       BIGINT,
    doctor_name     VARCHAR(64),
    clinical_diag   VARCHAR(512) COMMENT '临床诊断',
    sample_type     VARCHAR(32) NOT NULL COMMENT '标本类型(BLOOD/URINE/STOOL/CSF/...)',
    test_group      VARCHAR(64) COMMENT '检验组套',
    urgency         TINYINT DEFAULT 0,
    order_status    VARCHAR(16) DEFAULT 'ORDERED' COMMENT 'ORDERED/SAMPLE_COLLECTED/SAMPLE_RECEIVED/TESTING/REVIEWED/REPORTED/CANCELLED',
    barcode         VARCHAR(64) COMMENT '标本条码',
    collect_time    DATETIME COMMENT '采集时间',
    collect_nurse_id BIGINT,
    receive_time    DATETIME COMMENT '接收时间',
    receive_tech_id BIGINT,
    sample_quality  VARCHAR(16) COMMENT 'ACCEPTED/REJECTED',
    reject_reason   VARCHAR(256),
    report_time     DATETIME,
    reviewer_id     BIGINT COMMENT '审核人',
    reviewer_name   VARCHAR(64),
    review_time     DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_order_no (hospital_id, order_no),
    INDEX idx_patient (patient_id),
    INDEX idx_barcode (hospital_id, barcode)
);

-- 检验项目
CREATE TABLE lab_order_item (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    lab_order_id    BIGINT NOT NULL,
    test_item_code  VARCHAR(32) NOT NULL COMMENT '检验项目编码',
    test_item_name  VARCHAR(128) NOT NULL COMMENT '检验项目名称',
    test_group_code VARCHAR(32) COMMENT '检验组编码',
    sample_type     VARCHAR(32),
    result_value    VARCHAR(256) COMMENT '结果值',
    result_unit     VARCHAR(32) COMMENT '单位',
    reference_range VARCHAR(64) COMMENT '参考范围',
    abnormal_flag   VARCHAR(16) COMMENT 'H(高)/L(低)/HH(危急高)/LL(危急低)/A(异常)',
    result_status   VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/COMPLETED/REVIEWED',
    instrument_code VARCHAR(32) COMMENT '仪器编码',
    test_time       DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_order (lab_order_id)
);

-- 危急值记录
CREATE TABLE lab_critical_value (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    lab_order_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    test_item_name  VARCHAR(128),
    result_value    VARCHAR(256),
    reference_range VARCHAR(64),
    critical_level  VARCHAR(16) COMMENT 'CRITICAL_HIGH/CRITICAL_LOW',
    dept_id         BIGINT,
    doctor_id       BIGINT,
    notify_status   VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/NOTIFIED/CONFIRMED',
    notify_time     DATETIME COMMENT '通知时间',
    notify_method   VARCHAR(16) COMMENT 'PHONE/SMS',
    notify_person   VARCHAR(64) COMMENT '通知对象',
    confirm_person  VARCHAR(64) COMMENT '确认人',
    confirm_time    DATETIME,
    tech_id         BIGINT COMMENT '检验技师',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_patient (patient_id),
    INDEX idx_notify (notify_status)
);
```

### 业务规则

- 危急值发现后15分钟内通知临床医师
- 通知后30分钟内临床未确认，自动升级通知科主任
- 标本条码包含：患者ID、检验组套、采集时间
- 检验结果需经过至少两级审核（检验师→组长）
- 标本拒收需记录原因并通知重新采集
- 室内质控不通过时，当批次结果不可发布

---

## 7.2 影像管理（PACS）

### 功能详述

| 功能 | 说明 |
|---|---|
| 影像申请 | 接收检查申请、安排检查时间 |
| 检查签到 | 患者到达影像科签到 |
| 影像采集 | 设备采集影像（DR/CT/MR/DSA等） |
| DICOM接收 | 接收设备发送的DICOM影像 |
| 影像存储 | 影像归档存储（短期/长期） |
| 影像浏览 | Web端DICOM查看器（窗宽窗位/测量/标注） |
| 报告书写 | 结构化报告模板、影像所见+诊断意见 |
| 报告审核 | 初审→复审（双签制度） |
| 胶片打印 | 按需打印胶片 |
| 影像调阅 | 临床科室调阅影像和报告 |

### 数据模型

```sql
-- 影像检查
CREATE TABLE pacs_exam (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    exam_no         VARCHAR(32) NOT NULL COMMENT '检查号',
    accession_no    VARCHAR(32) COMMENT 'DICOM AccessionNumber',
    order_id        BIGINT COMMENT '医嘱ID',
    visit_id        BIGINT,
    admission_id    BIGINT,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    gender          VARCHAR(8),
    birth_date      DATE,
    modality        VARCHAR(16) NOT NULL COMMENT 'CT/MR/DR/CR/US/DSA/MG/NM/PET',
    exam_item       VARCHAR(256) NOT NULL COMMENT '检查项目',
    body_part       VARCHAR(64) COMMENT '检查部位',
    exam_device     VARCHAR(64) COMMENT '检查设备',
    exam_room       VARCHAR(32) COMMENT '检查室',
    clinical_info   TEXT COMMENT '临床信息',
    exam_status     VARCHAR(16) DEFAULT 'SCHEDULED' COMMENT 'SCHEDULED/ARRIVED/IN_EXAM/COMPLETED/REPORTED',
    exam_time       DATETIME,
    tech_id         BIGINT COMMENT '技师',
    tech_name       VARCHAR(64),
    image_count     INT DEFAULT 0 COMMENT '影像帧数',
    series_count    INT DEFAULT 0 COMMENT '序列数',
    storage_path    VARCHAR(512) COMMENT '存储路径',
    report_id       BIGINT,
    report_status   VARCHAR(16) DEFAULT 'NONE' COMMENT 'NONE/DRAFT/REVIEWED/PRINTED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_exam_no (hospital_id, exam_no),
    INDEX idx_patient (patient_id),
    INDEX idx_modality_date (modality, exam_time)
);

-- 影像报告
CREATE TABLE pacs_report (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    exam_id         BIGINT NOT NULL,
    report_no       VARCHAR(32),
    patient_id      BIGINT NOT NULL,
    modality        VARCHAR(16),
    exam_item       VARCHAR(256),
    clinical_diag   VARCHAR(512),
    findings        TEXT COMMENT '影像所见',
    impression      TEXT COMMENT '诊断意见',
    recommendation  TEXT COMMENT '建议',
    structured_data JSON COMMENT '结构化报告数据',
    report_doctor_id BIGINT NOT NULL,
    report_doctor_name VARCHAR(64),
    report_time     DATETIME,
    review_doctor_id BIGINT COMMENT '审核医师',
    review_doctor_name VARCHAR(64),
    review_time     DATETIME,
    report_status   VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/REVIEWED/PRINTED',
    print_count     INT DEFAULT 0,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_exam (exam_id)
);
```

---

## 7.3 其他医技模块

### 超声管理

与 PACS 类似结构，增加：
- 超声专用报告模板（按脏器/部位）
- 图文报告（超声图像 + 文字描述）
- 超声工作站对接

### 内镜管理

- 内镜图像采集（视频/截图）
- 内镜报告模板（胃镜/肠镜/支气管镜等）
- 活检标本管理

### 病理管理

| 功能 | 说明 |
|---|---|
| 病理申请 | 从手术/内镜申请病理检查 |
| 标本管理 | 标本接收、固定、取材、包埋、切片、染色 |
| 病理报告 | 免疫组化结果、病理诊断 |
| 冰冻切片 | 术中快速病理 |
| 会诊 | 病理会诊（院内/远程） |

```sql
CREATE TABLE path_order (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    path_no         VARCHAR(32) NOT NULL COMMENT '病理号',
    order_id        BIGINT,
    admission_id    BIGINT,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    path_type       VARCHAR(32) NOT NULL COMMENT '常规/冰冻/细胞学/免疫组化',
    specimen_source VARCHAR(64) COMMENT '标本来源',
    specimen_desc   TEXT COMMENT '标本描述',
    clinical_diag   VARCHAR(512),
    surgery_name    VARCHAR(256),
    gross_findings  TEXT COMMENT '大体所见',
    microscopic     TEXT COMMENT '镜下所见',
    path_diagnosis  TEXT COMMENT '病理诊断',
    immunohistochem JSON COMMENT '免疫组化结果',
    path_grade      VARCHAR(32) COMMENT '病理分级',
    path_stage      VARCHAR(32) COMMENT '病理分期',
    report_doctor_id BIGINT,
    review_doctor_id BIGINT,
    report_status   VARCHAR(16) DEFAULT 'RECEIVED' COMMENT 'RECEIVED/PROCESSING/REPORTED/REVIEWED',
    report_time     DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_path_no (hospital_id, path_no)
);
```

### 心电管理

- 心电图采集（静态/动态）
- 心电报告（自动分析 + 人工审核）
- 远程心电诊断

### 血库管理

| 功能 | 说明 |
|---|---|
| 血液入库 | 血站取血/送血后入库登记 |
| 配血 | 交叉配血试验 |
| 发血 | 配血合格后发血 |
| 用血记录 | 输血执行记录 |
| 不良反应 | 输血不良反应记录 |
| 血液报废 | 过期/不合格血液报废 |

```sql
CREATE TABLE blood_inventory (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    blood_type      VARCHAR(8) NOT NULL COMMENT 'ABO血型: A/B/AB/O',
    rh_type         VARCHAR(8) COMMENT 'RH: +/-',
    component       VARCHAR(32) NOT NULL COMMENT '血液成分: 全血/红细胞/血浆/血小板/冷沉淀',
    unit_no         VARCHAR(32) NOT NULL COMMENT '血液编号',
    volume          INT COMMENT '容量(ml)',
    source_station  VARCHAR(64) COMMENT '来源血站',
    collection_date DATE COMMENT '采集日期',
    expiry_date     DATE COMMENT '有效期',
    status          VARCHAR(16) DEFAULT 'AVAILABLE' COMMENT 'AVAILABLE/RESERVED/ISSUED/EXPIRED/DAMAGED',
    patient_id      BIGINT COMMENT '使用患者',
    issue_time      DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_blood (blood_type, component, status),
    INDEX idx_expiry (expiry_date)
);
```

---

# 八、医保与公卫

---

## 8.1 医保接口

### 功能详述

| 功能 | 说明 |
|---|---|
| 目录对照 | 医院收费项目与医保目录的对照 |
| 预结算 | 费用预计算（展示报销比例） |
| 实时结算 | 门诊/住院费用实时上传结算 |
| 对账 | 每日对账、差异处理 |
| 医保政策配置 | 起付线、封顶线、报销比例等参数化配置 |
| 异地就医 | 异地就医备案、结算 |
| 电子凭证 | 医保电子凭证扫码就医 |
| DRG/DIP | 病案首页上传、分组、费用监控 |

### 核心数据

```sql
-- 医保目录对照
CREATE TABLE mi_item_mapping (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    local_item_id   BIGINT NOT NULL COMMENT '本地项目ID',
    local_item_code VARCHAR(32) NOT NULL,
    local_item_name VARCHAR(256),
    mi_item_code    VARCHAR(32) NOT NULL COMMENT '医保目录编码',
    mi_item_name    VARCHAR(256),
    mi_type         VARCHAR(16) COMMENT '甲类/乙类/丙类',
    self_pay_ratio  DECIMAL(5,4) COMMENT '自付比例',
    mi_area_code    VARCHAR(16) COMMENT '医保区划',
    effective_date  DATE,
    expire_date     DATE,
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_mapping (hospital_id, local_item_id, mi_area_code)
);

-- 医保结算记录
CREATE TABLE mi_settlement (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    settle_no       VARCHAR(32) NOT NULL COMMENT '结算单号',
    mi_serial_no    VARCHAR(64) COMMENT '医保交易流水号',
    patient_id      BIGINT NOT NULL,
    mi_card_no      VARCHAR(64) COMMENT '医保卡号',
    mi_type         VARCHAR(32) COMMENT '医保类型(职工/居民/...)',
    mi_area_code    VARCHAR(16),
    settle_type     VARCHAR(16) COMMENT '门诊/住院',
    bill_id         BIGINT COMMENT '收费单ID',
    settle_id       BIGINT COMMENT '结算单ID',
    total_amount    DECIMAL(12,2) COMMENT '总费用',
    mi_amount       DECIMAL(12,2) COMMENT '医保支付总额',
    fund_amount     DECIMAL(12,2) COMMENT '统筹支付',
    personal_account DECIMAL(12,2) COMMENT '个账支付',
    self_pay_amount DECIMAL(12,2) COMMENT '自费金额',
    deductible      DECIMAL(12,2) COMMENT '起付线',
    over_ceiling    DECIMAL(12,2) COMMENT '超封顶线金额',
    settle_time     DATETIME,
    status          VARCHAR(16) DEFAULT 'SUCCESS' COMMENT 'SUCCESS/FAILED/REVERSED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_settle (hospital_id, settle_no)
);

-- DRG/DIP 分组
CREATE TABLE drg_case (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    primary_diag_code VARCHAR(32),
    primary_diag_name VARCHAR(256),
    procedure_code  VARCHAR(32),
    procedure_name  VARCHAR(256),
    drg_code        VARCHAR(32) COMMENT 'DRG分组编码',
    drg_name        VARCHAR(128) COMMENT 'DRG分组名称',
    drg_weight      DECIMAL(8,4) COMMENT '权重',
    actual_cost     DECIMAL(12,2) COMMENT '实际费用',
    standard_cost   DECIMAL(12,2) COMMENT '标准费用',
    cost_deviation  DECIMAL(12,2) COMMENT '费用偏差',
    los             INT COMMENT '住院天数',
    expected_los    INT COMMENT '预期住院天数',
    discharge_date  DATE,
    status          VARCHAR(16) DEFAULT 'PRELIMINARY' COMMENT 'PRELIMINARY/CONFIRMED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_hospital_date (hospital_id, discharge_date)
);
```

---

## 8.2 公卫上报

| 功能 | 说明 |
|---|---|
| 传染病上报 | 法定传染病自动筛查、填报、直报 |
| 死因上报 | 死亡病例死因链填报 |
| 肿瘤登记 | 恶性肿瘤新发病例上报 |
| 食源性疾病 | 食源性疾病监测上报 |
| 上报状态跟踪 | 上报状态查询、退回修改 |

```sql
CREATE TABLE report_infectious (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    report_no       VARCHAR(32) NOT NULL,
    patient_id      BIGINT NOT NULL,
    patient_name    VARCHAR(64),
    id_card         VARCHAR(32),
    gender          VARCHAR(8),
    age             INT,
    address         VARCHAR(256),
    occupation      VARCHAR(64),
    disease_code    VARCHAR(32) COMMENT '传染病编码',
    disease_name    VARCHAR(128),
    disease_category VARCHAR(16) COMMENT '甲类/乙类/丙类',
    diagnosis_date  DATE,
    report_date     DATE,
    report_doctor_id BIGINT,
    report_dept_id  BIGINT,
    diagnosis_basis VARCHAR(32) COMMENT '临床/实验室/疑似',
    severity        VARCHAR(16),
    outcome         VARCHAR(16) COMMENT '治愈/好转/死亡',
    report_status   VARCHAR(16) DEFAULT 'DRAFT' COMMENT 'DRAFT/SUBMITTED/ACCEPTED/RETURNED',
    submit_time     DATETIME,
    cdc_feedback    VARCHAR(512) COMMENT '疾控反馈',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_report_no (hospital_id, report_no)
);
```

---

# 九、患者服务

---

## 9.1 患者主索引（EMPI）

| 功能 | 说明 |
|---|---|
| 患者主索引 | 全院统一患者标识，跨院区身份关联 |
| 身份合并 | 同一患者多次建档的合并（模糊匹配+人工确认） |
| 身份拆分 | 误合并的患者拆分 |
| 患者画像 | 汇总患者所有诊疗数据 |

```sql
CREATE TABLE patient_master (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    empi_id         VARCHAR(32) NOT NULL COMMENT '全局唯一患者标识',
    patient_name    VARCHAR(64) NOT NULL,
    gender          VARCHAR(8),
    birth_date      DATE,
    id_card         VARCHAR(32),
    phone           VARCHAR(16),
    address         VARCHAR(256),
    nationality     VARCHAR(32) COMMENT '民族',
    marital_status  VARCHAR(16),
    occupation      VARCHAR(64),
    blood_type      VARCHAR(8),
    allergy_history TEXT COMMENT '过敏史',
    medical_history TEXT COMMENT '既往病史',
    family_history  TEXT COMMENT '家族史',
    emergency_contact VARCHAR(64),
    emergency_phone VARCHAR(16),
    insurance_type  VARCHAR(32),
    insurance_no    VARCHAR(64),
    health_card_no  VARCHAR(64) COMMENT '健康卡号',
    merge_status    VARCHAR(16) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/MERGED/DELETED',
    merged_into     BIGINT COMMENT '合并到哪个ID',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    update_time     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_empi (hospital_id, empi_id),
    INDEX idx_name (patient_name),
    INDEX idx_id_card (id_card),
    INDEX idx_phone (phone)
);

-- 患者合并记录
CREATE TABLE patient_merge_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    source_patient_id BIGINT NOT NULL,
    target_patient_id BIGINT NOT NULL,
    merge_reason    VARCHAR(256),
    merge_type      VARCHAR(16) COMMENT 'AUTO/MANUAL',
    operator_id     BIGINT NOT NULL,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 9.2 互联网医院

| 功能 | 说明 |
|---|---|
| 在线问诊 | 图文问诊、视频问诊 |
| 在线复诊 | 复诊患者在线续方 |
| 电子处方 | 在线开具处方，药师审核 |
| 药品配送 | 对接药品配送（到家/到店自取） |
| 问诊排班 | 医生在线排班 |
| 问诊收费 | 在线问诊费收取 |

```sql
CREATE TABLE internet_consult (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    consult_no      VARCHAR(32) NOT NULL,
    patient_id      BIGINT NOT NULL,
    doctor_id       BIGINT NOT NULL,
    consult_type    VARCHAR(16) NOT NULL COMMENT 'GRAPHIC/VIDEO/PHONE',
    consult_mode    VARCHAR(16) COMMENT 'FIRST_VISIT/REVISIT',
    dept_id         BIGINT,
    disease_desc    VARCHAR(512) COMMENT '病情描述',
    images          JSON COMMENT '患者上传图片',
    fee_amount      DECIMAL(10,2),
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/IN_PROGRESS/COMPLETED/TIMEOUT/CANCELLED',
    start_time      DATETIME,
    end_time        DATETIME,
    timeout_time    DATETIME COMMENT '超时时间',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_consult_no (hospital_id, consult_no)
);

CREATE TABLE internet_consult_message (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    consult_id      BIGINT NOT NULL,
    sender_type     VARCHAR(16) NOT NULL COMMENT 'PATIENT/DOCTOR',
    sender_id       BIGINT NOT NULL,
    message_type    VARCHAR(16) COMMENT 'TEXT/IMAGE/VOICE/VIDEO',
    content         TEXT,
    media_url       VARCHAR(512),
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_consult (consult_id, create_time)
);
```

---

## 9.3 随访管理

| 功能 | 说明 |
|---|---|
| 随访计划 | 出院后自动/手动创建随访计划 |
| 随访任务 | 按计划生成随访任务，护士/医生执行 |
| 随访模板 | 按病种的随访问卷模板 |
| 随访记录 | 随访内容记录（电话/短信/上门/门诊） |
| 满意度调查 | 住院/门诊满意度问卷 |

```sql
CREATE TABLE followup_plan (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    admission_id    BIGINT COMMENT '关联住院',
    plan_name       VARCHAR(128),
    disease_name    VARCHAR(128),
    template_id     BIGINT COMMENT '随访模板',
    executor_id     BIGINT COMMENT '执行人',
    frequency       VARCHAR(32) COMMENT '随访频率',
    total_times     INT COMMENT '总次数',
    completed_times INT DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'ACTIVE' COMMENT 'ACTIVE/COMPLETED/TERMINATED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE followup_task (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    plan_id         BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    task_seq        INT COMMENT '第几次随访',
    plan_date       DATE COMMENT '计划日期',
    actual_date     DATE COMMENT '实际日期',
    method          VARCHAR(16) COMMENT 'PHONE/SMS/VISIT/OUTPATIENT',
    executor_id     BIGINT,
    executor_name   VARCHAR(64),
    content         TEXT COMMENT '随访内容',
    patient_feedback TEXT COMMENT '患者反馈',
    status          VARCHAR(16) DEFAULT 'PENDING' COMMENT 'PENDING/COMPLETED/OVERDUE/SKIPPED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

# 十、运营与决策管理

---

## 10.1 院长驾驶舱

### 核心指标

| 指标分类 | 具体指标 |
|---|---|
| 门诊量 | 今日门诊量、同比/环比、趋势图、科室排名 |
| 住院量 | 在院人数、今日入院/出院、床位使用率 |
| 收入 | 今日收入、本月累计、收入结构（药占比/耗占比/检查占比） |
| 药品 | 药占比、抗菌药物使用率、基本药物使用率 |
| 医疗质量 | 平均住院日、术前等待天数、抢救成功率 |
| 医保 | 医保总额使用率、次均费用、DRG权重 |
| 患者满意度 | 满意度评分、投诉统计 |

### 数据模型

```sql
-- 统计快照（每日预计算）
CREATE TABLE stat_daily_snapshot (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    stat_date       DATE NOT NULL,
    dept_id         BIGINT COMMENT 'NULL=全院',
    -- 门诊指标
    op_reg_count    INT DEFAULT 0 COMMENT '门诊挂号量',
    op_visit_count  INT DEFAULT 0 COMMENT '门诊就诊量',
    op_emergency_count INT DEFAULT 0 COMMENT '急诊量',
    -- 住院指标
    ip_admit_count  INT DEFAULT 0 COMMENT '入院人数',
    ip_discharge_count INT DEFAULT 0 COMMENT '出院人数',
    ip_inhospital   INT DEFAULT 0 COMMENT '在院人数',
    ip_surgery_count INT DEFAULT 0 COMMENT '手术台次',
    bed_total       INT DEFAULT 0 COMMENT '总床位',
    bed_occupied    INT DEFAULT 0 COMMENT '占用床位',
    bed_rate        DECIMAL(5,2) COMMENT '床位使用率',
    avg_los         DECIMAL(5,1) COMMENT '平均住院日',
    -- 收入指标
    op_revenue      DECIMAL(14,2) DEFAULT 0 COMMENT '门诊收入',
    ip_revenue      DECIMAL(14,2) DEFAULT 0 COMMENT '住院收入',
    total_revenue   DECIMAL(14,2) DEFAULT 0 COMMENT '总收入',
    drug_revenue    DECIMAL(14,2) DEFAULT 0 COMMENT '药品收入',
    exam_revenue    DECIMAL(14,2) DEFAULT 0 COMMENT '检查收入',
    lab_revenue     DECIMAL(14,2) DEFAULT 0 COMMENT '检验收入',
    material_revenue DECIMAL(14,2) DEFAULT 0 COMMENT '耗材收入',
    drug_ratio      DECIMAL(5,2) COMMENT '药占比',
    -- 医保指标
    mi_total_cost   DECIMAL(14,2) DEFAULT 0 COMMENT '医保总费用',
    mi_per_capita   DECIMAL(10,2) COMMENT '次均费用',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_snapshot (hospital_id, stat_date, dept_id)
);
```

---

## 10.2 科室运营分析 / 医生绩效

| 功能 | 说明 |
|---|---|
| 科室工作量 | 门诊量/住院量/手术量/检查量按科室统计 |
| 医生工作量 | 按医生统计门诊量/处方量/手术量 |
| 收入分析 | 按科室/医生的收入结构分析 |
| 绩效核算 | 基于工作量和质量指标的绩效计算 |
| 报表导出 | Excel/PDF导出 |

---

# 十一、质量控制与安全管理

---

## 11.1 临床路径

| 功能 | 说明 |
|---|---|
| 路径定义 | 定义标准诊疗流程（入径标准→诊疗项目→变异处理→出径标准） |
| 路径执行 | 患者入径后按标准流程执行 |
| 变异管理 | 记录偏离标准路径的变异及原因 |
| 路径监控 | 入径率、完成率、变异率监控 |
| 路径评价 | 路径效果分析（费用/住院日对比） |

```sql
CREATE TABLE cp_pathway (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    pathway_code    VARCHAR(32) NOT NULL,
    pathway_name    VARCHAR(128) NOT NULL,
    disease_name    VARCHAR(128),
    icd_code        VARCHAR(32),
    standard_los    INT COMMENT '标准住院日',
    standard_cost   DECIMAL(12,2) COMMENT '标准费用',
    entry_criteria  TEXT COMMENT '入径标准',
    exit_criteria   TEXT COMMENT '出径标准',
    exclude_criteria TEXT COMMENT '排除标准',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, pathway_code)
);

CREATE TABLE cp_pathway_stage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    pathway_id      BIGINT NOT NULL,
    stage_seq       INT NOT NULL COMMENT '阶段序号',
    stage_name      VARCHAR(64) NOT NULL COMMENT '阶段名称(术前/手术日/术后1天/...)',
    day_range       VARCHAR(32) COMMENT '天数范围',
    required_orders JSON COMMENT '必选医嘱',
    optional_orders JSON COMMENT '可选医嘱',
    nursing_measures JSON COMMENT '护理措施',
    patient_education JSON COMMENT '患者教育',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pathway (pathway_id, stage_seq)
);

CREATE TABLE cp_patient_pathway (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    pathway_id      BIGINT NOT NULL,
    entry_date      DATE NOT NULL,
    current_stage   INT DEFAULT 1,
    exit_date       DATE,
    exit_reason     VARCHAR(256) COMMENT '出径原因',
    status          VARCHAR(16) DEFAULT 'IN_PROGRESS' COMMENT 'IN_PROGRESS/COMPLETED/EXITED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE cp_variation (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    patient_pathway_id BIGINT NOT NULL,
    stage_seq       INT,
    variation_type  VARCHAR(32) COMMENT 'ORDER_VARIATION/TIME_VARIATION/COST_VARIATION',
    variation_desc  TEXT NOT NULL,
    variation_reason TEXT,
    doctor_id       BIGINT,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_pathway (patient_pathway_id)
);
```

---

## 11.2 抗菌药物管理

| 功能 | 说明 |
|---|---|
| 分级管理 | 非限制/限制/特殊三级管理 |
| 处方权限 | 按职称授予不同级别抗菌药物处方权 |
| 使用审批 | 特殊使用级抗菌药物需专家会诊后审批 |
| DDD值监控 | 抗菌药物使用强度（DDDs/100人天）统计 |
| 用药目的 | 区分预防/治疗用药 |
| 送检率 | 使用前微生物送检率监控 |

```sql
CREATE TABLE antimicrobial_drug (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    drug_name       VARCHAR(256),
    level           VARCHAR(16) NOT NULL COMMENT 'NON_RESTRICTED/RESTRICTED/SPECIAL',
    ddd_value       DECIMAL(8,3) COMMENT 'DDD值',
    ddd_unit        VARCHAR(16) COMMENT 'DDD单位',
    min_title       VARCHAR(32) COMMENT '最低处方权限职称',
    need_culture    TINYINT DEFAULT 1 COMMENT '使用前是否需微生物送检',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE antimicrobial_approval (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    admission_id    BIGINT NOT NULL,
    patient_id      BIGINT NOT NULL,
    drug_id         BIGINT NOT NULL,
    drug_name       VARCHAR(256),
    approval_level  VARCHAR(16) COMMENT 'RESTRICTED/SPECIAL',
    apply_doctor_id BIGINT NOT NULL,
    apply_reason    TEXT,
    usage_purpose   VARCHAR(16) COMMENT 'PROPHYLAXIS/TREATMENT',
    culture_done    TINYINT DEFAULT 0 COMMENT '是否已送检',
    approver_id     BIGINT,
    approve_time    DATETIME,
    approve_result  VARCHAR(16) COMMENT 'APPROVED/REJECTED',
    approve_opinion VARCHAR(256),
    status          VARCHAR(16) DEFAULT 'PENDING',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 11.3 不良事件上报

| 功能 | 说明 |
|---|---|
| 事件分类 | 医疗/护理/药品/院感/设备/治安/输血不良事件 |
| 匿名上报 | 支持匿名上报保护 |
| 事件处理 | 事件调查、根因分析（RCA）、处理意见 |
| 改进追踪 | 改进措施制定、执行、效果评价 |
| 统计分析 | 不良事件趋势分析 |

```sql
CREATE TABLE safety_event (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    event_no        VARCHAR(32) NOT NULL,
    event_type      VARCHAR(32) NOT NULL COMMENT 'MEDICAL/NURSING/DRUG/INFECTION/EQUIPMENT/TRANSFUSION',
    event_level     VARCHAR(16) COMMENT '严重程度: LEVEL1/LEVEL2/LEVEL3/LEVEL4',
    event_time      DATETIME NOT NULL,
    event_dept_id   BIGINT,
    event_location  VARCHAR(128),
    patient_id      BIGINT COMMENT '涉及患者',
    event_desc      TEXT NOT NULL COMMENT '事件描述',
    immediate_action TEXT COMMENT '即时处理措施',
    reporter_id     BIGINT COMMENT '上报人(可匿名)',
    reporter_name   VARCHAR(64),
    is_anonymous    TINYINT DEFAULT 0,
    status          VARCHAR(16) DEFAULT 'REPORTED' COMMENT 'REPORTED/INVESTIGATING/ANALYZING/IMPROVING/CLOSED',
    investigator_id BIGINT,
    rca_analysis    TEXT COMMENT '根因分析',
    improvement_plan TEXT COMMENT '改进措施',
    improvement_deadline DATE,
    improvement_status VARCHAR(16) COMMENT '改进执行状态',
    close_time      DATETIME,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_event_no (hospital_id, event_no)
);
```

---

# 十二、供应链与后勤

---

## 12.1 耗材管理

| 功能 | 说明 |
|---|---|
| 高值耗材 | 一物一码管理、跟台管理、扫码使用 |
| 低值耗材 | 进销存管理 |
| 采购管理 | 采购计划、订单、验收 |
| 库存管理 | 库存上下限预警、盘点 |
| 消耗统计 | 按科室/手术/医生的耗材消耗分析 |
| 效期管理 | 与药品类似的效期管理 |

```sql
CREATE TABLE mat_material (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    material_code   VARCHAR(32) NOT NULL,
    material_name   VARCHAR(256) NOT NULL,
    specification   VARCHAR(128),
    category        VARCHAR(32) COMMENT 'HIGH_VALUE/LOW_VALUE',
    unit            VARCHAR(16),
    unit_price      DECIMAL(12,4),
    manufacturer    VARCHAR(128),
    approval_no     VARCHAR(64),
    udi_code        VARCHAR(64) COMMENT 'UDI编码',
    is_implant      TINYINT DEFAULT 0 COMMENT '是否植入物',
    is_sterile      TINYINT DEFAULT 0 COMMENT '是否无菌',
    storage_condition VARCHAR(64) COMMENT '存储条件',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, material_code)
);

CREATE TABLE mat_stock (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    warehouse_id    BIGINT NOT NULL,
    material_id     BIGINT NOT NULL,
    batch_no        VARCHAR(64),
    serial_no       VARCHAR(64) COMMENT '序列号(高值耗材)',
    expiry_date     DATE,
    quantity        DECIMAL(12,2) DEFAULT 0,
    unit_cost       DECIMAL(12,4),
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_warehouse_material (warehouse_id, material_id)
);

-- 高值耗材使用记录
CREATE TABLE mat_usage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    material_id     BIGINT NOT NULL,
    serial_no       VARCHAR(64),
    udi_code        VARCHAR(64),
    admission_id    BIGINT COMMENT '住院患者',
    patient_id      BIGINT,
    surgery_id      BIGINT COMMENT '手术ID',
    doctor_id       BIGINT COMMENT '使用医生',
    usage_time      DATETIME NOT NULL,
    scan_confirm    TINYINT DEFAULT 0 COMMENT '是否扫码确认',
    billing_status  VARCHAR(16) DEFAULT 'UNBILLED' COMMENT 'UNBILLED/BILLED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_patient (patient_id)
);
```

---

## 12.2 设备管理

| 功能 | 说明 |
|---|---|
| 设备台账 | 设备基本信息、购入日期、使用科室、折旧 |
| 维修管理 | 故障报修、维修记录、维修费用 |
| 保养管理 | 定期保养计划、保养记录 |
| 计量检测 | 医疗设备计量检测计划、检测记录 |
| 报废管理 | 设备报废申请、审批 |

```sql
CREATE TABLE eqp_equipment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    equipment_code  VARCHAR(32) NOT NULL,
    equipment_name  VARCHAR(256) NOT NULL,
    category        VARCHAR(32),
    model           VARCHAR(64),
    manufacturer    VARCHAR(128),
    serial_no       VARCHAR(64),
    purchase_date   DATE,
    purchase_price  DECIMAL(14,2),
    current_value   DECIMAL(14,2),
    dept_id         BIGINT COMMENT '使用科室',
    location        VARCHAR(128),
    warranty_date   DATE COMMENT '保修到期',
    status          VARCHAR(16) DEFAULT 'IN_USE' COMMENT 'IN_USE/MAINTENANCE/IDLE/SCRAPPED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (hospital_id, equipment_code)
);

CREATE TABLE eqp_maintenance (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    equipment_id    BIGINT NOT NULL,
    maintenance_type VARCHAR(16) COMMENT 'REPAIR/PREVENTIVE/CALIBRATION',
    plan_date       DATE,
    actual_date     DATE,
    description     TEXT,
    cost            DECIMAL(10,2),
    technician      VARCHAR(64),
    result          VARCHAR(16) COMMENT 'NORMAL/NEED_PARTS/SCRAPPED',
    next_plan_date  DATE,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_equipment (equipment_id)
);
```

---

# 十三、人力资源

---

## 13.1 排班管理

| 功能 | 说明 |
|---|---|
| 门诊排班 | 医生门诊出诊排班（关联号源） |
| 病房排班 | 护士排班（白班/小夜/大夜） |
| 排班模板 | 按科室的排班模板 |
| 排班规则 | 连续工作天数限制、夜班间隔等规则 |
| 换班管理 | 换班申请、审批 |
| 排班统计 | 出勤统计、夜班次数统计 |

```sql
CREATE TABLE hr_schedule (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    dept_id         BIGINT NOT NULL,
    user_id         BIGINT NOT NULL,
    user_name       VARCHAR(64),
    schedule_date   DATE NOT NULL,
    shift_type      VARCHAR(16) NOT NULL COMMENT 'DAY/NIGHT/MORNING/AFTERNOON/FULL',
    start_time      TIME,
    end_time        TIME,
    schedule_type   VARCHAR(16) COMMENT 'OUTPATIENT/WARD/ON_CALL',
    status          VARCHAR(16) DEFAULT 'NORMAL' COMMENT 'NORMAL/LEAVE/SWAPPED',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user_date (user_id, schedule_date),
    INDEX idx_dept_date (dept_id, schedule_date)
);
```

---

## 13.2 执业资质管理

| 功能 | 说明 |
|---|---|
| 资质登记 | 医师执业证、护士执业证、药师证等 |
| 到期提醒 | 资质到期前30天/60天提醒 |
| 执业范围 | 医师执业范围管理 |
| 处方权限 | 基于资质的处方权限控制 |

```sql
CREATE TABLE hr_qualification (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    hospital_id     BIGINT NOT NULL,
    user_id         BIGINT NOT NULL,
    qual_type       VARCHAR(32) NOT NULL COMMENT 'DOCTOR_LICENSE/NURSE_LICENSE/PHARMACIST_LICENSE/SPECIAL_EQUIPMENT',
    qual_no         VARCHAR(64) NOT NULL COMMENT '证书编号',
    qual_name       VARCHAR(128),
    issue_authority VARCHAR(128) COMMENT '发证机关',
    issue_date      DATE,
    expiry_date     DATE,
    scope           VARCHAR(256) COMMENT '执业范围',
    image_url       VARCHAR(512) COMMENT '证书扫描件',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_user (user_id)
);
```

---

# 十四、集成与互联互通

---

## 14.1 集成平台（ESB）

| 功能 | 说明 |
|---|---|
| 消息总线 | 统一消息路由，解耦各子系统 |
| 协议适配 | HL7 v2/v3、FHIR、WebService、REST、TCP等协议转换 |
| 消息转换 | 消息格式转换（HL7↔JSON↔XML） |
| 消息监控 | 消息流监控、失败重试、死信队列 |
| 服务注册 | 各系统服务注册与发现 |

```
┌─────────┐    ┌──────────────┐    ┌─────────┐
│  HIS    │◄──►│              │◄──►│   LIS   │
└─────────┘    │              │    └─────────┘
               │  集成引擎     │
┌─────────┐    │  (消息路由)   │    ┌─────────┐
│  PACS   │◄──►│              │◄──►│ 医保系统 │
└─────────┘    │              │    └─────────┘
               │  协议适配层   │
┌─────────┐    │  消息转换     │    ┌─────────┐
│  电子病历 │◄──►│  服务编排     │◄──►│ 区域平台 │
└─────────┘    └──────────────┘    └─────────┘
```

### 数据模型

```sql
CREATE TABLE integration_service (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    service_code    VARCHAR(64) NOT NULL,
    service_name    VARCHAR(128) NOT NULL,
    service_type    VARCHAR(32) COMMENT 'PROVIDER/CONSUMER',
    protocol        VARCHAR(16) COMMENT 'REST/HL7/WEBSERVICE/TCP',
    endpoint_url    VARCHAR(512),
    source_system   VARCHAR(64),
    target_system   VARCHAR(64),
    message_format  VARCHAR(16) COMMENT 'JSON/XML/HL7',
    transform_rule  TEXT COMMENT '转换规则',
    status          TINYINT DEFAULT 1,
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_code (service_code)
);

CREATE TABLE integration_message_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT,
    message_id      VARCHAR(64) NOT NULL COMMENT '消息ID',
    service_code    VARCHAR(64),
    source_system   VARCHAR(64),
    target_system   VARCHAR(64),
    direction       VARCHAR(8) COMMENT 'IN/OUT',
    message_type    VARCHAR(32),
    request_content TEXT,
    response_content TEXT,
    status          VARCHAR(16) COMMENT 'SUCCESS/FAILED/RETRYING',
    retry_count     INT DEFAULT 0,
    error_msg       TEXT,
    duration        BIGINT COMMENT '耗时ms',
    create_time     DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_time (create_time),
    INDEX idx_status (status)
);
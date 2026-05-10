/**
 * HiCorLite 子系统气泡菜单组件
 * 用法：在页面中引入此文件，然后调用 initSubsystemMenu(menuData)
 */

function initSubsystemMenu(menuData) {
  if (!document.getElementById('subsys-menu-styles')) {
    const style = document.createElement('style');
    style.id = 'subsys-menu-styles';
    style.textContent = `
      .menu-trigger {
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 8px; cursor: pointer;
        color: rgba(255,255,255,.75);
        transition: all .2s; position: relative;
      }
      .menu-trigger:hover { background: rgba(255,255,255,.15); color: #fff; }
      .menu-trigger.active { background: rgba(255,255,255,.2); color: #fff; }
      .menu-trigger .trigger-badge {
        position: absolute; top: 3px; right: 3px;
        width: 7px; height: 7px; background: #f59e0b;
        border-radius: 50%; border: 2px solid #6366f1;
      }

      /* 遮罩 */
      .menu-popover-mask {
        position: fixed; inset: 0; z-index: 299;
      }

      /* 气泡弹出框 */
      .menu-popover {
        position: absolute;
        top: calc(100% + 10px); left: 50%;
        transform: translateX(-50%);
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 12px 48px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.04);
        padding: 18px 22px 14px;
        min-width: 400px; max-width: min(90vw, 860px);
        z-index: 300;
        animation: popIn .22s cubic-bezier(.34,1.56,.64,1);
      }
      .menu-popover::before {
        content: '';
        position: absolute;
        top: -7px; left: 50%;
        transform: translateX(-50%) rotate(45deg);
        width: 14px; height: 14px;
        background: #fff;
        box-shadow: -2px -2px 4px rgba(0,0,0,.04);
        border-radius: 2px;
      }
      @keyframes popIn {
        from { opacity: 0; transform: translateX(-50%) translateY(-6px) scale(.96); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
      }

      .menu-popover-header {
        font-size: 12px; color: #94a3b8; font-weight: 600;
        text-transform: uppercase; letter-spacing: 1.5px;
        margin-bottom: 14px; padding-bottom: 10px;
        border-bottom: 1px solid #f1f5f9;
      }

      /* 分组网格 */
      .menu-popover-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 10px;
      }
      .menu-popover-card {
        background: #f8fafc; border: 1px solid #e8ecf1;
        border-radius: 12px; padding: 14px 14px 10px;
        transition: all .2s;
      }
      .menu-popover-card:hover {
        border-color: #c7d2fe; background: #f0f4ff;
        box-shadow: 0 4px 12px rgba(99,102,241,.08);
      }
      .menu-popover-card-title {
        font-size: 13px; font-weight: 600; color: #475569;
        margin-bottom: 8px; display: flex; align-items: center; gap: 6px;
        padding-bottom: 7px; border-bottom: 1px solid #e8ecf1;
      }
      .menu-popover-card-items { display: flex; flex-direction: column; gap: 1px; }
      .menu-popover-card-item {
        padding: 6px 8px; border-radius: 7px; font-size: 13px;
        color: #475569; cursor: pointer; transition: all .15s;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .menu-popover-card-item:hover { background: #e0e7ff; color: #3730a3; }
      .menu-popover-card-item.active { background: #dbeafe; color: #1d4ed8; font-weight: 500; }

      /* 底部 */
      .menu-popover-footer {
        margin-top: 12px; padding-top: 10px;
        border-top: 1px solid #f1f5f9;
        display: flex; justify-content: center;
      }
      .menu-popover-back {
        padding: 7px 20px; border-radius: 9px; font-size: 13px;
        color: #64748b; cursor: pointer; transition: all .2s;
        display: flex; align-items: center; gap: 6px;
        background: #f8fafc; border: 1px solid #e2e8f0;
      }
      .menu-popover-back:hover { background: #eff6ff; color: #4a6cf7; border-color: #93c5fd; }

      /* 搜索高亮 */
      .menu-popover-card-item mark {
        background: #fef08a; color: #1e293b;
        padding: 0 2px; border-radius: 2px;
      }
    `;
    document.head.appendChild(style);
  }

  return {
    template: `
      <div style="position:relative;display:inline-flex;" @click.stop>
        <div class="menu-trigger" :class="{active: visible}" @click="toggle" title="功能菜单 (Ctrl+M)">
          <svg viewBox="0 0 1024 1024" width="18" height="18"><path fill="currentColor" d="M160 256h704a32 32 0 1 0 0-64H160a32 32 0 0 0 0 64zm704 224H160a32 32 0 0 0 0 64h704a32 32 0 1 0 0-64zm0 288H160a32 32 0 0 0 0 64h704a32 32 0 1 0 0-64z"/></svg>
          <span class="trigger-badge" v-if="!visible"></span>
        </div>
        <!-- 遮罩 -->
        <div class="menu-popover-mask" v-if="visible" @click="close"></div>
        <!-- 气泡 -->
        <div class="menu-popover" v-if="visible" @click.stop>
          <div class="menu-popover-header">{{ systemName }} · 功能导航</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;">
            <div class="menu-popover-card" v-for="group in filteredGroups" :key="group.key">
              <div class="menu-popover-card-title">
                <span>{{ group.icon }}</span> {{ group.label }}
              </div>
              <div class="menu-popover-card-items">
                <div class="menu-popover-card-item" v-for="item in group._items" :key="item.key"
                  :class="{active: activeItem === item.key}"
                  @click="onSelect(group.label, item)">
                  <span v-if="searchKw" v-html="highlight(item.label)"></span>
                  <span v-else>{{ item.label }}</span>
                </div>
              </div>
            </div>
          </div>
          <div class="menu-popover-footer" v-if="showBack">
            <div class="menu-popover-back" @click="goHome">
              <span>🏠</span> 返回总控中心
            </div>
          </div>
        </div>
      </div>
    `,
    props: {
      systemName: { type: String, default: '系统' },
      menuData: { type: Array, default: () => [] },
      showBack: { type: Boolean, default: true },
    },
    emits: ['select', 'home'],
    data() {
      return { visible: false, searchKw: '', activeItem: '' };
    },
    computed: {
      filteredGroups() {
        const kw = this.searchKw.toLowerCase();
        return this.menuData.map(g => {
          const items = kw
            ? g.items.filter(i => i.label.toLowerCase().includes(kw))
            : g.items;
          return items.length ? { ...g, _items: items } : null;
        }).filter(Boolean);
      },
    },
    methods: {
      toggle() {
        this.visible = !this.visible;
        if (this.visible) this.searchKw = '';
      },
      close() { this.visible = false; },
      onSelect(groupLabel, item) {
        this.activeItem = item.key;
        this.visible = false;
        this.$emit('select', { key: item.key, groupLabel, itemLabel: item.label });
      },
      goHome() {
        this.visible = false;
        this.$emit('home');
        window.location.href = 'index.html';
      },
      highlight(text) {
        const kw = this.searchKw;
        const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')})`, 'gi');
        return text.replace(re, '<mark>$1</mark>');
      },
    },
    mounted() {
      document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') { e.preventDefault(); this.toggle(); }
        if (e.key === 'Escape' && this.visible) this.close();
      });
      document.addEventListener('click', () => { if (this.visible) this.close(); });
    },
  };
}

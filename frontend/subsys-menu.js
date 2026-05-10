/**
 * HiCorLite 子系统通用顶部菜单组件
 * 用法：在页面中引入此文件，然后调用 initSubsystemMenu(menuData)
 */

function initSubsystemMenu(menuData) {
  // 注入样式
  if (!document.getElementById('subsys-menu-styles')) {
    const style = document.createElement('style');
    style.id = 'subsys-menu-styles';
    style.textContent = `
      /* ===== 菜单触发按钮 ===== */
      .menu-trigger {
        width: 36px; height: 36px;
        display: flex; align-items: center; justify-content: center;
        border-radius: 8px; cursor: pointer;
        color: rgba(255,255,255,0.8);
        transition: all 0.2s;
        margin-left: 12px;
        position: relative;
      }
      .menu-trigger:hover { background: rgba(255,255,255,0.15); color: #fff; }
      .menu-trigger.active { background: rgba(255,255,255,0.2); color: #fff; }
      .menu-trigger .trigger-badge {
        position: absolute; top: 4px; right: 4px;
        width: 8px; height: 8px; background: #f59e0b;
        border-radius: 50%; border: 2px solid #6366f1;
      }

      /* ===== 遮罩层 ===== */
      .menu-overlay {
        position: fixed; top: 56px; left: 0; right: 0; bottom: 0;
        background: rgba(15,23,42,0.4);
        backdrop-filter: blur(4px);
        z-index: 200;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
      }
      .menu-overlay.open { opacity: 1; visibility: visible; }

      /* ===== 菜单面板 ===== */
      .menu-panel {
        position: fixed; top: 56px; left: 0; right: 0;
        max-height: calc(100vh - 56px);
        background: #fff;
        box-shadow: 0 20px 60px rgba(0,0,0,0.15);
        z-index: 201;
        transform: translateY(-20px);
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex; flex-direction: column;
        overflow: hidden;
      }
      .menu-panel.open { transform: translateY(0); opacity: 1; visibility: visible; }

      /* ===== 搜索区 ===== */
      .menu-search-bar {
        padding: 20px 32px 16px;
        border-bottom: 1px solid #f0f2f5;
        flex-shrink: 0;
        display: flex; align-items: center; gap: 16px;
      }
      .menu-search-bar .search-icon {
        width: 40px; height: 40px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #4a6cf7, #6366f1);
        border-radius: 12px; color: #fff; font-size: 18px; flex-shrink: 0;
      }
      .menu-search-bar .search-input-large {
        flex: 1; height: 44px;
        border: 2px solid #e8ecf1; border-radius: 12px;
        padding: 0 16px; font-size: 15px; color: #303133;
        outline: none; transition: all 0.2s;
        background: #f8fafc;
      }
      .menu-search-bar .search-input-large:focus {
        border-color: #4a6cf7; background: #fff;
        box-shadow: 0 0 0 3px rgba(74,108,247,0.1);
      }
      .menu-search-bar .search-input-large::placeholder { color: #94a3b8; }
      .menu-search-bar .search-count {
        font-size: 13px; color: #94a3b8; flex-shrink: 0;
        padding: 6px 12px; background: #f1f5f9; border-radius: 8px;
      }

      /* ===== 菜单内容区 ===== */
      .menu-content {
        flex: 1; overflow-y: auto; padding: 8px 32px 24px;
      }
      .menu-content::-webkit-scrollbar { width: 6px; }
      .menu-content::-webkit-scrollbar-thumb { background: #d0d5dd; border-radius: 3px; }

      /* ===== 分组 ===== */
      .menu-group-section { margin-bottom: 24px; }
      .menu-group-section:last-child { margin-bottom: 0; }

      .menu-group-header {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 0 12px;
        border-bottom: 2px solid #f0f2f5;
        margin-bottom: 12px;
      }
      .menu-group-header .group-icon {
        width: 32px; height: 32px;
        display: flex; align-items: center; justify-content: center;
        background: linear-gradient(135deg, #eff6ff, #e0e7ff);
        border-radius: 10px; font-size: 16px; flex-shrink: 0;
      }
      .menu-group-header .group-label {
        font-size: 16px; font-weight: 700; color: #1e293b;
        letter-spacing: 0.5px;
      }
      .menu-group-header .group-count {
        font-size: 12px; color: #94a3b8; background: #f1f5f9;
        padding: 2px 10px; border-radius: 10px; font-weight: 500;
      }

      /* ===== 菜单网格 ===== */
      .menu-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 10px;
      }

      .menu-grid-item {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px;
        background: #f8fafc;
        border: 1px solid #e8ecf1;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        text-decoration: none;
      }
      .menu-grid-item:hover {
        background: #eff6ff; border-color: #93c5fd;
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(59,130,246,0.1);
      }
      .menu-grid-item.active {
        background: #dbeafe; border-color: #3b82f6;
        box-shadow: 0 2px 8px rgba(59,130,246,0.15);
      }
      .menu-grid-item .item-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #cbd5e1; flex-shrink: 0;
        transition: background 0.2s;
      }
      .menu-grid-item:hover .item-dot { background: #60a5fa; }
      .menu-grid-item.active .item-dot { background: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.2); }
      .menu-grid-item .item-text {
        font-size: 14px; color: #475569; font-weight: 500;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .menu-grid-item:hover .item-text { color: #1e40af; }
      .menu-grid-item.active .item-text { color: #1e40af; font-weight: 600; }

      /* 搜索高亮 */
      .menu-grid-item .item-text mark {
        background: #fef08a; color: #1e293b;
        padding: 0 2px; border-radius: 2px;
      }

      /* 无结果 */
      .menu-empty {
        text-align: center; padding: 60px 20px; color: #94a3b8;
      }
      .menu-empty .empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
      .menu-empty .empty-text { font-size: 15px; }

      /* 快捷键提示 */
      .menu-shortcut {
        position: absolute; bottom: 16px; right: 32px;
        font-size: 12px; color: #94a3b8;
        display: flex; align-items: center; gap: 6px;
      }
      .menu-shortcut kbd {
        padding: 2px 8px; background: #f1f5f9; border: 1px solid #e2e8f0;
        border-radius: 4px; font-size: 11px; font-family: monospace;
      }

      @media (max-width: 1200px) {
        .menu-grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
      }
      @media (max-width: 900px) {
        .menu-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
        .menu-content { padding: 8px 16px 24px; }
        .menu-search-bar { padding: 16px; }
      }
    `;
    document.head.appendChild(style);
  }

  return {
    template: `
      <!-- 菜单触发按钮 -->
      <div class="menu-trigger" :class="{active: menuVisible}" @click.stop="toggleMenu" title="功能菜单 (Ctrl+M)">
        <svg viewBox="0 0 1024 1024" width="20" height="20">
          <path fill="currentColor" d="M160 256h704a32 32 0 1 0 0-64H160a32 32 0 0 0 0 64zm704 224H160a32 32 0 0 0 0 64h704a32 32 0 1 0 0-64zm0 288H160a32 32 0 0 0 0 64h704a32 32 0 1 0 0-64z"/>
        </svg>
        <span class="trigger-badge" v-if="!menuVisible"></span>
      </div>

      <!-- 遮罩 -->
      <div class="menu-overlay" :class="{open: menuVisible}" @click="closeMenu"></div>

      <!-- 菜单面板 -->
      <div class="menu-panel" :class="{open: menuVisible}" @click.stop>
        <!-- 搜索 -->
        <div class="menu-search-bar">
          <div class="search-icon">🔍</div>
          <input class="search-input-large" v-model="searchKw" :placeholder="'搜索 ' + systemName + ' 的功能...'" ref="searchInput" @keydown.escape="closeMenu">
          <span class="search-count" v-if="searchKw">{{ matchCount }} 项匹配</span>
          <span class="search-count" v-else>{{ totalCount }} 项功能</span>
        </div>

        <!-- 内容 -->
        <div class="menu-content" v-if="matchCount > 0">
          <div class="menu-group-section" v-for="group in filteredGroups" :key="group.key">
            <div class="menu-group-header">
              <span class="group-icon">{{ group.icon }}</span>
              <span class="group-label">{{ group.label }}</span>
              <span class="group-count">{{ group.matchedItems.length }} 项</span>
            </div>
            <div class="menu-grid">
              <div class="menu-grid-item" v-for="item in group.matchedItems" :key="item.key"
                :class="{active: activeItem === item.key}"
                @click="onSelect(item.key, group.label, item.label)">
                <span class="item-dot"></span>
                <span class="item-text" v-html="highlightText(item.label)"></span>
              </div>
            </div>
          </div>
        </div>

        <!-- 空状态 -->
        <div class="menu-empty" v-else>
          <div class="empty-icon">🔍</div>
          <div class="empty-text">没有找到 "{{ searchKw }}" 相关的功能</div>
        </div>
      </div>
    `,

    props: {
      systemName: { type: String, default: '系统' },
      menuData: { type: Array, default: () => [] },
      initialItem: { type: String, default: '' },
    },

    emits: ['select'],

    data() {
      return {
        menuVisible: false,
        searchKw: '',
        activeItem: this.initialItem,
      };
    },

    computed: {
      filteredGroups() {
        const kw = this.searchKw.toLowerCase();
        return this.menuData.map(group => {
          const items = kw
            ? group.items.filter(i => i.label.toLowerCase().includes(kw) || group.label.toLowerCase().includes(kw))
            : group.items;
          if (items.length === 0 && !group.label.toLowerCase().includes(kw)) return null;
          return { ...group, matchedItems: items.length ? items : group.items };
        }).filter(Boolean);
      },
      totalCount() {
        return this.menuData.reduce((sum, g) => sum + g.items.length, 0);
      },
      matchCount() {
        return this.filteredGroups.reduce((sum, g) => sum + g.matchedItems.length, 0);
      },
    },

    methods: {
      toggleMenu() {
        this.menuVisible = !this.menuVisible;
        if (this.menuVisible) {
          this.searchKw = '';
          this.$nextTick(() => {
            if (this.$refs.searchInput) this.$refs.searchInput.focus();
          });
        }
      },
      closeMenu() {
        this.menuVisible = false;
      },
      onSelect(key, groupLabel, itemLabel) {
        this.activeItem = key;
        this.menuVisible = false;
        this.$emit('select', { key, groupLabel, itemLabel });
      },
      highlightText(text) {
        if (!this.searchKw) return text;
        const kw = this.searchKw;
        const re = new RegExp(`(${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(re, '<mark>$1</mark>');
      },
    },

    mounted() {
      // Ctrl+M 快捷键
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
          e.preventDefault();
          this.toggleMenu();
        }
        if (e.key === 'Escape' && this.menuVisible) {
          this.closeMenu();
        }
      });
      // 点击外部关闭
      document.addEventListener('click', () => {
        if (this.menuVisible) this.closeMenu();
      });
    },
  };
}

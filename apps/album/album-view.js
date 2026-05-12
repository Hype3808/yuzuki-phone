/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

export class AlbumView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this.images = [];
        this.previewOpen = false;
        this.selectionMode = false;
        this.selectedPaths = new Set();
    }

    loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('album-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'album-css';
        link.rel = 'stylesheet';
        link.href = new URL('./album.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    render() {
        this.loadCSS();
        this.images = this.app.albumData.getImages();
        const currentPaths = new Set(this.images.map(image => image.path));
        this.selectedPaths = new Set([...this.selectedPaths].filter(path => currentPaths.has(path)));
        if (this.images.length === 0) {
            this.selectionMode = false;
            this.selectedPaths.clear();
        }
        const selectedCount = this.selectedPaths.size;
        const allSelected = this.images.length > 0 && selectedCount === this.images.length;
        const html = `
            <div class="album-app${this.selectionMode ? ' album-selecting' : ''}">
                <header class="album-header">
                    <button type="button" class="album-icon-btn" id="album-back" aria-label="返回">
                        <i class="fa-solid ${this.selectionMode ? 'fa-xmark' : 'fa-chevron-left'}"></i>
                    </button>
                    <div class="album-title-wrap">
                        <div class="album-title">${this.selectionMode ? `已选 ${selectedCount} 张` : '相册'}</div>
                        <div class="album-subtitle">${this.images.length ? `共 ${this.images.length} 张图片` : '暂无图片'}</div>
                    </div>
                    <div class="album-header-actions">
                        ${this.selectionMode ? `
                            <button type="button" class="album-select-btn" id="album-select-all">${allSelected ? '取消全选' : '全选'}</button>
                            <button type="button" class="album-icon-btn album-danger-btn" id="album-delete-selected" aria-label="删除所选" ${selectedCount ? '' : 'disabled'}>
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        ` : `
                            <button type="button" class="album-select-btn" id="album-select-toggle">选择</button>
                        `}
                    </div>
                </header>
                <main class="album-body">
                    ${this.images.length ? this.renderGrid() : this.renderEmpty()}
                </main>
            </div>
        `;

        this.app.phoneShell.setContent(html, 'album-main');
        requestAnimationFrame(() => this.bindEvents());
    }

    renderGrid() {
        return `
            <div class="album-grid">
                ${this.images.map((image, index) => `
                    <div class="album-tile${this.selectedPaths.has(image.path) ? ' selected' : ''}" data-index="${index}" title="${this.escapeHtml(image.filename)}">
                        <button type="button" class="album-tile-main" data-index="${index}" aria-label="查看图片">
                            <img src="${this.escapeAttr(image.src)}" alt="">
                            <span class="album-source">${this.escapeHtml(this.getPrimarySource(image))}</span>
                            <span class="album-checkmark"><i class="fa-solid fa-check"></i></span>
                        </button>
                        ${this.selectionMode ? '' : `
                            <button type="button" class="album-tile-delete" data-index="${index}" aria-label="删除图片">
                                <i class="fa-regular fa-trash-can"></i>
                            </button>
                        `}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderEmpty() {
        return `
            <div class="album-empty">
                <div class="album-empty-icon"><i class="fa-regular fa-images"></i></div>
                <div class="album-empty-title">还没有上传图片</div>
                <div class="album-empty-copy">微信、微博、蜜语、日记、壁纸和图标里保存过的图片会显示在这里。</div>
            </div>
        `;
    }

    bindEvents() {
        document.getElementById('album-back')?.addEventListener('click', () => {
            if (this.selectionMode) {
                this.selectionMode = false;
                this.selectedPaths.clear();
                this.render();
                return;
            }
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        document.getElementById('album-select-toggle')?.addEventListener('click', () => {
            this.selectionMode = true;
            this.selectedPaths.clear();
            this.render();
        });
        document.getElementById('album-select-all')?.addEventListener('click', () => this.toggleSelectAll());
        document.getElementById('album-delete-selected')?.addEventListener('click', () => this.deleteSelectedImages());
        document.querySelectorAll('.album-tile-main').forEach(tile => {
            tile.addEventListener('click', () => {
                const index = Number.parseInt(tile.dataset.index, 10);
                if (this.selectionMode) {
                    this.toggleSelected(index);
                    return;
                }
                this.openPreview(index);
            });
        });
        document.querySelectorAll('.album-tile-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = Number.parseInt(btn.dataset.index, 10);
                this.deleteImage(this.images[index]);
            });
        });
        document.querySelectorAll('.album-tile img').forEach(img => {
            img.addEventListener('error', () => {
                img.closest('.album-tile')?.classList.add('is-broken');
            }, { once: true });
        });
    }

    toggleSelected(index) {
        const image = this.images[index];
        if (!image) return;
        if (this.selectedPaths.has(image.path)) {
            this.selectedPaths.delete(image.path);
        } else {
            this.selectedPaths.add(image.path);
        }
        this.render();
    }

    toggleSelectAll() {
        if (!this.selectionMode) return;
        if (this.selectedPaths.size === this.images.length) {
            this.selectedPaths.clear();
        } else {
            this.selectedPaths = new Set(this.images.map(image => image.path));
        }
        this.render();
    }

    openPreview(index) {
        const image = this.images[index];
        if (!image) return;
        this.previewOpen = true;
        document.querySelector('.album-preview')?.remove();

        const overlay = document.createElement('div');
        overlay.className = 'album-preview';
        overlay.innerHTML = `
            <div class="album-preview-panel">
                <div class="album-preview-top">
                    <button type="button" class="album-preview-close" aria-label="关闭">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                    <button type="button" class="album-preview-delete" aria-label="删除">
                        <i class="fa-regular fa-trash-can"></i>
                    </button>
                </div>
                <div class="album-preview-image-wrap">
                    <img class="album-preview-image" src="${this.escapeAttr(image.src)}" alt="">
                </div>
                <div class="album-preview-meta">
                    <div class="album-preview-name">${this.escapeHtml(image.filename)}</div>
                    <div class="album-preview-path">${this.escapeHtml(image.path)}</div>
                    <div class="album-preview-tags">
                        ${image.sources.slice(0, 4).map(source => `<span>${this.escapeHtml(source)}</span>`).join('')}
                    </div>
                </div>
            </div>
        `;

        document.querySelector('.album-app')?.appendChild(overlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) this.closePreview();
        });
        overlay.querySelector('.album-preview-close')?.addEventListener('click', () => this.closePreview());
        overlay.querySelector('.album-preview-delete')?.addEventListener('click', () => this.deleteImage(image));
    }

    closePreview() {
        this.previewOpen = false;
        document.querySelector('.album-preview')?.remove();
    }

    async deleteImage(image) {
        if (!image) return;
        const ok = window.confirm('删除这张图片吗？引用它的壁纸、图标或记录也会清空。');
        if (!ok) return;

        const deleteBtn = document.querySelector('.album-preview-delete');
        if (deleteBtn) deleteBtn.disabled = true;
        try {
            const result = await this.app.albumData.deleteImage(image.path);
            this.app.phoneShell?.showNotification?.('相册', result.message || '图片已删除', '🖼️');
        } catch (e) {
            console.error('删除相册图片失败:', e);
            this.app.phoneShell?.showNotification?.('相册', '删除失败', '⚠️');
        }
        this.previewOpen = false;
        this.render();
    }

    async deleteSelectedImages() {
        const selected = this.images.filter(image => this.selectedPaths.has(image.path));
        if (selected.length === 0) return;
        const ok = window.confirm(`删除选中的 ${selected.length} 张图片吗？引用它们的壁纸、图标或记录也会清空。`);
        if (!ok) return;

        const deleteBtn = document.getElementById('album-delete-selected');
        if (deleteBtn) deleteBtn.disabled = true;
        let successCount = 0;
        for (const image of selected) {
            try {
                await this.app.albumData.deleteImage(image.path);
                successCount += 1;
            } catch (e) {
                console.error('批量删除相册图片失败:', image.path, e);
            }
        }
        this.app.phoneShell?.showNotification?.('相册', `已删除 ${successCount} 张图片`, '🖼️');
        this.selectionMode = false;
        this.selectedPaths.clear();
        this.render();
    }

    getPrimarySource(image) {
        return image?.sources?.[0] || '图片';
    }

    escapeHtml(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    escapeAttr(text) {
        return this.escapeHtml(text).replace(/`/g, '&#96;');
    }
}

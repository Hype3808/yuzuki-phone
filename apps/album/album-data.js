/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

const MANAGED_IMAGE_RE = /(https?:\/\/[^\s"'<>)]*\/backgrounds\/phone_[^\s"'<>)]*|\/backgrounds\/phone_[^\s"'<>)]*)/ig;
const MEDIA_EXT_RE = /\.(?:mp4|webm|mov|m4v)$/i;

export class AlbumData {
    constructor(storage) {
        this.storage = storage;
        this.deletedKey = 'phone_album_deleted_paths';
    }

    getImages() {
        const items = new Map();
        const deleted = this._getDeletedSet();
        let order = 0;

        const addImage = (pathLike, sourceLabel = '小手机') => {
            const normalized = this.normalizePath(pathLike);
            if (!normalized || deleted.has(normalized)) return;
            if (!this.isManagedImagePath(normalized)) return;

            const existing = items.get(normalized);
            if (existing) {
                if (sourceLabel && !existing.sources.includes(sourceLabel)) {
                    existing.sources.push(sourceLabel);
                }
                existing.refCount += 1;
                return;
            }

            items.set(normalized, {
                id: normalized,
                src: this.toDisplayPath(pathLike),
                path: normalized,
                filename: this.getFilename(normalized),
                sources: sourceLabel ? [sourceLabel] : [],
                refCount: 1,
                order: order++
            });
        };

        this._scanKnownStores(addImage);
        this._scanRuntimeData(addImage);
        this._scanLocalStorage(addImage);

        return Array.from(items.values()).sort((a, b) => b.order - a.order);
    }

    async deleteImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return { success: false, message: '图片路径无效' };

        const imageManager = window.VirtualPhone?.imageManager;
        let deleteResult = { attempted: false, success: false };
        if (imageManager?.deleteManagedBackgroundByPath) {
            deleteResult = await imageManager.deleteManagedBackgroundByPath(normalized, { quiet: true });
        }

        await this.cleanupReferences(normalized);
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);

        return {
            success: true,
            fileDeleted: !!deleteResult.success,
            attempted: !!deleteResult.attempted,
            message: deleteResult.success ? '图片已删除' : '图片记录已删除'
        };
    }

    async markMissingImage(pathLike) {
        const normalized = this.normalizePath(pathLike);
        if (!normalized || !this.isManagedImagePath(normalized)) return false;
        await this._markDeleted(normalized);
        await this._removeUploadIndexPath(normalized);
        return true;
    }

    async cleanupReferences(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;

        const imageManager = window.VirtualPhone?.imageManager;
        if (imageManager?.cache) {
            let changed = false;
            if (this.normalizePath(imageManager.cache.wallpaper) === target) {
                imageManager.cache.wallpaper = null;
                changed = true;
                window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { wallpaper: null } }));
            }

            ['appIcons', 'avatars'].forEach(groupKey => {
                const group = imageManager.cache[groupKey];
                if (!group || typeof group !== 'object') return;
                Object.keys(group).forEach(key => {
                    if (this.normalizePath(group[key]) === target) {
                        delete group[key];
                        changed = true;
                    }
                });
            });

            if (changed && imageManager.saveImages) {
                await imageManager.saveImages(imageManager.cache);
                window.dispatchEvent(new CustomEvent('phone:updateAppIcon'));
            }
        }

        if (this.normalizePath(this.storage?.get?.('phone-card-time-image')) === target) {
            await this.storage.remove('phone-card-time-image');
            window.dispatchEvent(new CustomEvent('phone:updateWallpaper', { detail: { cardTimeImage: null } }));
        }

        this._cleanupStorageStore(this.storage?._getChatMetadataStore?.(), target, 'chat');
        this._cleanupStorageStore(this.storage?._getExtensionSettingsStore?.(), target, 'settings');
    }

    normalizePath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        let value = raw.split('?')[0].split('#')[0];
        try {
            if (/^https?:\/\//i.test(value)) {
                value = new URL(value).pathname;
            }
        } catch (e) { }
        return value;
    }

    toDisplayPath(pathLike) {
        const raw = String(pathLike || '').trim();
        if (!raw) return '';
        if (/^https?:\/\//i.test(raw)) return raw;
        return this.normalizePath(raw);
    }

    isManagedImagePath(pathLike) {
        const value = this.normalizePath(pathLike);
        return /\/backgrounds\/phone_[^/]+/i.test(value) && !MEDIA_EXT_RE.test(value);
    }

    getFilename(pathLike) {
        const normalized = this.normalizePath(pathLike);
        return normalized.split('/').filter(Boolean).pop() || 'image';
    }

    _scanKnownStores(addImage) {
        const imageManager = window.VirtualPhone?.imageManager;
        this._scanAlbumUploadIndex(addImage);
        this._scanValue(imageManager?.cache, '本地上传', addImage);
        this._scanValue(this.storage?.get?.('phone-card-time-image'), '时间卡片背景', addImage);
        this._scanValue(this.storage?._getChatMetadataStore?.(), '聊天数据', addImage);
        this._scanValue(this.storage?._getExtensionSettingsStore?.(), '全局设置', addImage);
    }

    _scanAlbumUploadIndex(addImage) {
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            list.forEach(item => {
                const path = typeof item === 'string' ? item : item?.path;
                addImage(path, this._labelFromUploadPrefix(item?.prefix));
            });
        } catch (e) { }
    }

    _scanRuntimeData(addImage) {
        const phone = window.VirtualPhone || {};
        this._scanValue(phone.wechatApp?.wechatData?.data, '微信', addImage);
        try {
            const chats = phone.wechatApp?.wechatData?.data?.chats || [];
            chats.forEach(chat => {
                const messages = phone.wechatApp.wechatData.getMessages?.(chat.id);
                this._scanValue(messages, `微信消息:${chat.name || chat.id}`, addImage);
            });
        } catch (e) { }
        this._scanValue(phone.weiboApp?.weiboData, '微博', addImage);
        this._scanValue(phone.honeyApp?.honeyData, '蜜语', addImage);
        this._scanValue(phone.diaryApp?.diaryData, '日记', addImage);
        this._scanValue(phone.mofoApp?.mofoData, '魔坊', addImage);
    }

    _scanLocalStorage(addImage) {
        try {
            for (let i = 0; i < window.localStorage.length; i += 1) {
                const key = window.localStorage.key(i);
                if (!key || (!key.includes('virtual_phone') && !key.includes('st_virtual_phone'))) continue;
                this._scanValue(window.localStorage.getItem(key), `本地备份:${key}`, addImage);
            }
        } catch (e) { }
    }

    _scanValue(value, sourceLabel, addImage, seen = new Set(), depth = 0) {
        if (value === null || value === undefined) return;
        if (typeof value === 'string') {
            let match;
            MANAGED_IMAGE_RE.lastIndex = 0;
            while ((match = MANAGED_IMAGE_RE.exec(value)) !== null) {
                addImage(match[1], sourceLabel);
            }
            return;
        }
        if (typeof value !== 'object' || seen.has(value) || depth > 8) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach(item => this._scanValue(item, sourceLabel, addImage, seen, depth + 1));
            return;
        }
        Object.entries(value).forEach(([key, item]) => {
            const label = this._labelFromKey(key, sourceLabel);
            this._scanValue(item, label, addImage, seen, depth + 1);
        });
    }

    _labelFromKey(key, fallback) {
        const value = String(key || '');
        if (value.includes('wechat')) return '微信';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card-time')) return '时间卡片背景';
        if (value.includes('phone_image_paths')) return '本地上传';
        if (value.includes('phone_album_upload_index')) return '本地上传';
        return fallback || '小手机';
    }

    _labelFromUploadPrefix(prefix) {
        const value = String(prefix || '').toLowerCase();
        if (value.includes('wallpaper')) return '手机壁纸';
        if (value.includes('card_time')) return '时间卡片背景';
        if (value.includes('icon_')) return 'App图标';
        if (value.includes('avatar')) return '头像';
        if (value.includes('wechat')) return '微信';
        if (value.includes('weibo')) return '微博';
        if (value.includes('honey')) return '蜜语';
        if (value.includes('diary')) return '日记';
        if (value.includes('emoji')) return '表情包';
        return '本地上传';
    }

    _cleanupStorageStore(store, target, scope) {
        if (!store || typeof store !== 'object') return;
        let changed = false;
        Object.keys(store).forEach(key => {
            if (key === this.deletedKey) return;
            const result = this._removePathFromValue(store[key], target);
            if (result.changed) {
                store[key] = result.value;
                changed = true;
            }
        });

        if (!changed) return;
        if (scope === 'chat') {
            this.storage?._debouncedSaveChat?.();
        } else {
            this.storage?._queuedSaveExtensionSettings?.();
        }
    }

    _removePathFromValue(value, target, seen = new Set()) {
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (this.normalizePath(trimmed) === target) {
                return { value: '', changed: true };
            }
            if (!trimmed.includes('/backgrounds/')) {
                return { value, changed: false };
            }
            try {
                const parsed = JSON.parse(trimmed);
                const result = this._removePathFromValue(parsed, target, seen);
                if (result.changed) {
                    return { value: JSON.stringify(result.value), changed: true };
                }
            } catch (e) { }
            if (trimmed.includes(target)) {
                return { value: value.replaceAll(target, ''), changed: true };
            }
            return { value, changed: false };
        }

        if (value === null || value === undefined || typeof value !== 'object' || seen.has(value)) {
            return { value, changed: false };
        }
        seen.add(value);

        if (Array.isArray(value)) {
            let changed = false;
            const next = [];
            value.forEach(item => {
                if (typeof item === 'string' && this.normalizePath(item) === target) {
                    changed = true;
                    return;
                }
                const result = this._removePathFromValue(item, target, seen);
                if (result.changed) changed = true;
                next.push(result.value);
            });
            return { value: next, changed };
        }

        let changed = false;
        Object.keys(value).forEach(key => {
            const item = value[key];
            if (typeof item === 'string' && this.normalizePath(item) === target) {
                delete value[key];
                changed = true;
                return;
            }
            const result = this._removePathFromValue(item, target, seen);
            if (result.changed) {
                value[key] = result.value;
                changed = true;
            }
        });
        return { value, changed };
    }

    _getDeletedSet() {
        try {
            const raw = this.storage?.get?.(this.deletedKey, '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            return new Set(list.map(item => this.normalizePath(item)).filter(Boolean));
        } catch (e) {
            return new Set();
        }
    }

    async _markDeleted(pathLike) {
        const deleted = this._getDeletedSet();
        const normalized = this.normalizePath(pathLike);
        if (!normalized) return;
        deleted.add(normalized);
        await this.storage?.set?.(this.deletedKey, JSON.stringify(Array.from(deleted).slice(-500)));
    }

    async _removeUploadIndexPath(pathLike) {
        const target = this.normalizePath(pathLike);
        if (!target) return;
        try {
            const raw = this.storage?.get?.('phone_album_upload_index', '[]');
            const list = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            const next = list.filter(item => this.normalizePath(item?.path || item) !== target);
            if (next.length === list.length) return;
            await this.storage?.set?.('phone_album_upload_index', JSON.stringify(next));
        } catch (e) { }
    }
}

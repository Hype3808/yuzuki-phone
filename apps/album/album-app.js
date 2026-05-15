/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 *  作者 (Author): yuzuki
 *
 * Copyright (c) yuzuki. All rights reserved.
 * ======================================================== */

import { AlbumData } from './album-data.js';
import { AlbumView } from './album-view.js';

export class AlbumApp {
    constructor(phoneShell, storage) {
        this.phoneShell = phoneShell;
        this.storage = storage;
        this.albumData = new AlbumData(storage);
        this.albumView = new AlbumView(this);

        window.addEventListener('phone:swipeBack', (e) => this.handleSwipeBack(e));
        window.addEventListener('phone:albumImageDeleted', () => this.refreshIfVisible());
    }

    render() {
        this.albumView.render();
    }

    handleSwipeBack() {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;

        if (this.albumView.previewOpen) {
            this.albumView.closePreview();
            return;
        }

        window.dispatchEvent(new CustomEvent('phone:goHome'));
    }

    refreshIfVisible() {
        const domCurrentView = document.querySelector('.phone-view-current');
        if (!domCurrentView?.querySelector?.('.album-app')) return;
        this.albumView.render();
    }
}

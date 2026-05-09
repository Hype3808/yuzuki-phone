/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 * ======================================================== */

import { STREET_LABELS } from './games-data.js';

export class GamesView {
    constructor(app) {
        this.app = app;
        this._cssLoaded = false;
        this._actionPanelOpen = false;
        this._logPanelOpen = false;
        this._pendingChatInput = '';
        this._wagerModalOpen = false;
        this._wagerModalAction = '';
        this._wagerModalValue = '';
        this._wagerModalDefault = 0;
        this._setupOpen = false;
    }

    renderLobby() {
        this._loadCSS();
        const html = `
            <div class="games-app games-lobby">
                <div class="games-topbar">
                    <button class="games-back-btn" id="games-back-home" type="button" aria-label="返回">
                        <i class="fa-solid fa-chevron-left"></i>
                    </button>
                    <div>
                        <div class="games-title">游戏</div>
                        <div class="games-subtitle">选择一个游戏开始</div>
                    </div>
                </div>

                <div class="games-lobby-content">
                    <button class="games-game-card games-poker-card" id="games-open-poker" type="button">
                        <div class="games-game-art">
                            <div class="games-game-card-stack">
                                ${this._renderCard({ rank: 'A', suitSymbol: '♠', color: 'black' }, true)}
                                ${this._renderCard({ rank: 'K', suitSymbol: '♥', color: 'red' }, true)}
                            </div>
                        </div>
                        <div class="games-game-info">
                            <div class="games-game-title">德州扑克</div>
                            <div class="games-game-desc">2-6人牌桌 · 单机筹码 · 本地AI</div>
                            <div class="games-game-meta">
                                <span>可玩</span>
                            </div>
                        </div>
                        <i class="fa-solid fa-chevron-right games-game-chevron"></i>
                    </button>

                    <div class="games-coming-grid">
                        <div class="games-coming-card">
                            <div class="games-coming-icon">狼</div>
                            <div>狼人杀</div>
                            <span>待接入</span>
                        </div>
                    </div>
                </div>
                ${this._renderPokerSetupOverlay()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-lobby');
        this._bindLobbyEvents();
    }

    renderPoker() {
        this._loadCSS();
        const state = this.app.gamesData.getState();
        if (!state) {
            this._setupOpen = true;
            this.renderLobby();
            return;
        }
        const actions = this.app.gamesData.getUserActions();

        const html = `
            <div class="games-app">
                <div class="games-topbar">
                    <div>
                        <div class="games-title">德州扑克</div>
                        <div class="games-subtitle">第 ${state.handNo} 局 · ${STREET_LABELS[state.street] || '牌桌'}</div>
                    </div>
                    <button class="games-icon-btn games-icon-btn-home" id="games-back-lobby" type="button" title="返回大厅">
                        <i class="fa-solid fa-house"></i>
                    </button>
                </div>

                <div class="games-poker-table-wrap">
                    <div class="games-poker-table">
                        ${state.players.filter(player => player.id !== 'user').map(player => this._renderSeat(player, state)).join('')}
                        <div class="games-board">
                            <div class="games-pot">
                                <span>底池</span>
                                <strong>${this._fmt(state.pot)}</strong>
                            </div>
                            <div class="games-community">
                                ${[0, 1, 2, 3, 4].map(idx => this._renderCard(state.community[idx], true)).join('')}
                            </div>
                            <div class="games-round-info">
                                <span>最低跟注 ${this._fmt(Math.max(0, state.currentBet - this._user(state).bet))}</span>
                                <span>当前注额 ${this._fmt(state.currentBet)}</span>
                            </div>
                        </div>
                        ${this._renderSeat(this._user(state), state)}
                    </div>
                </div>

                <div class="games-bottom-panel">
                    <div class="games-message">
                        <span><i class="fa-solid fa-user-tie"></i> 荷官</span>
                        <strong>${this._escape(state.dealerMessage || state.message || '')}</strong>
                    </div>
                    ${this._renderActionPanel(state, actions)}
                </div>
                ${this._renderWagerModal()}
            </div>
        `;

        this.app.phoneShell.setContent(html, 'games-poker');
        this._bindPokerEvents();
    }

    openPokerSetupOverlay() {
        this._setupOpen = true;
        this.renderLobby();
    }

    _renderPokerSetupOverlay() {
        if (!this._setupOpen) return '';
        const selectedCount = this.app.gamesData.getSelectedPlayerCount();
        const chipsMode = this.app.gamesData.getChipsMode();
        return `
            <div class="games-setup-overlay" id="games-setup-overlay">
                <div class="games-setup-panel">
                    <div class="games-setup-hero">
                        <div class="games-game-card-stack">
                            ${this._renderCard({ rank: 'A', suitSymbol: '♠', color: 'black' }, true)}
                            ${this._renderCard({ rank: 'K', suitSymbol: '♥', color: 'red' }, true)}
                        </div>
                        <div>
                            <div class="games-game-title">德州扑克</div>
                        </div>
                    </div>

                    <div class="games-setup-label">游戏人数</div>
                    <div class="games-player-count-grid">
                        ${[2, 3, 4, 5, 6].map(count => `
                            <button class="games-player-count-btn ${count === selectedCount ? 'is-active' : ''}" type="button" data-player-count="${count}">
                                ${count}人
                            </button>
                        `).join('')}
                    </div>

                    <div class="games-setup-label">起始筹码</div>
                    <div class="games-chips-mode-grid">
                        <button class="games-player-count-btn ${chipsMode === 'equal' ? 'is-active' : ''}" type="button" data-chips-mode="equal">
                            平均筹码
                        </button>
                        <button class="games-player-count-btn ${chipsMode === 'random' ? 'is-active' : ''}" type="button" data-chips-mode="random">
                            随机筹码
                        </button>
                    </div>

                    <div class="games-setup-actions">
                        <button class="games-player-count-btn" id="games-poker-setup-cancel" type="button">取消</button>
                        <button class="games-primary-btn games-start-btn" id="games-start-poker" type="button">开始游戏</button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderSeat(player, state) {
        const isUser = player.id === 'user';
        const isActive = state.activePlayerId === player.id && state.phase === 'playing';
        const reveal = isUser || state.phase === 'showdown' || state.phase === 'complete';
        const dealer = state.players[state.dealerIndex]?.id === player.id;
        const seatClass = [
            'games-seat',
            `games-seat-${player.seat}`,
            isUser ? 'games-seat-user' : '',
            isActive ? 'is-active' : '',
            player.folded ? 'is-folded' : '',
            player.allIn ? 'is-allin' : ''
        ].filter(Boolean).join(' ');
        const handLabel = player.bestHand?.label || (isUser && state.community.length >= 3
            ? this.app.gamesData.evaluateBestHand([...player.cards, ...state.community])?.label
            : '');

        return `
            <div class="${seatClass}">
                <div class="games-seat-cards">
                    ${player.cards.map(card => this._renderCard(card, reveal)).join('')}
                </div>
                <div class="games-player-plate">
                    <div class="games-avatar">${this.app.renderPlayerAvatar(player)}</div>
                    <div class="games-player-meta">
                        <div class="games-player-name">
                            ${this._escape(player.name)}
                        </div>
                        <div class="games-player-chips">${this._fmt(player.chips)}</div>
                    </div>
                </div>
                ${dealer ? '<span class="games-dealer">D</span>' : ''}
                <div class="games-player-status">${this._escape(player.status || (isActive ? '待行动' : '等待'))}</div>
                ${player.bet > 0 ? `<div class="games-bet-chip">${this._fmt(player.bet)}</div>` : ''}
                ${handLabel ? `<div class="games-hand-label">${this._escape(handLabel)}</div>` : ''}
            </div>
        `;
    }

    _renderCard(card, reveal) {
        if (!card || !reveal) {
            return `<div class="games-card games-card-back"><span></span></div>`;
        }
        return `
            <div class="games-card games-card-${card.color}">
                <strong>${this._escape(card.rank)}</strong>
                <span>${this._escape(card.suitSymbol)}</span>
            </div>
        `;
    }

    _renderActionPanel(state, actions) {
        const logSheet = this._renderLog(state);
        if (state.phase === 'showdown' || state.phase === 'complete') {
            this._actionPanelOpen = false;
            this._wagerModalOpen = false;
            this._wagerModalValue = '';
            return `
                <div class="games-action-entry">
                    <button id="games-log-toggle" class="games-log-toggle ${this._logPanelOpen ? 'is-open' : ''}" type="button" aria-expanded="${this._logPanelOpen ? 'true' : 'false'}" title="回合记录">
                        <i class="fa-solid fa-bell"></i>
                    </button>
                    <div class="games-action-input games-action-input-static">查看本局结算</div>
                    <div class="games-action-toggle-spacer" aria-hidden="true"></div>
                </div>
                <div class="games-bottom-float-layer">
                    ${logSheet}
                </div>
                <div class="games-result">
                    ${(state.awards || []).map(item => `
                        <div>${this._escape(item.name)} 赢得 ${this._fmt(item.amount)} · ${this._escape(item.hand)}</div>
                    `).join('')}
                </div>
                <button class="games-primary-btn" id="games-next-hand" type="button">下一局</button>
            `;
        }

        const raiseBase = Math.max(state.currentBet + state.minRaise, state.bigBlind);
        const betBase = Math.max(state.bigBlind, state.minRaise);
        const wagerAction = actions.canBet ? 'bet' : 'raise';
        const defaultWager = actions.canBet ? betBase : raiseBase;
        const wagerLabel = actions.canBet ? '下注' : '加注';
        const canWager = actions.canBet || actions.canRaise;
        const callLabel = actions.callAmount ? `跟注 ${this._fmt(actions.callAmount)}` : '跟注';
        const inputValue = this._escape(this._pendingChatInput);
        const user = this._user(state);
        const maxWager = user ? (user.bet + user.chips) : defaultWager;
        const actionItems = [];
        if (actions.canCheck) {
            actionItems.push(`<button class="games-action-btn" data-action="check">过牌</button>`);
        }
        if (actions.canCall) {
            actionItems.push(`<button class="games-action-btn" data-action="call">${callLabel}</button>`);
        }
        if (canWager) {
            actionItems.push(`<button class="games-action-btn" data-action="${wagerAction}" data-open-wager="1" data-default-amount="${defaultWager}">${wagerLabel}</button>`);
            actionItems.push(`<button class="games-action-btn games-random-wager-btn" data-action="${wagerAction}" data-open-wager="1" data-random-wager="1" data-default-amount="${defaultWager}" data-max-amount="${Math.max(defaultWager, maxWager)}">随机${wagerLabel}</button>`);
        }
        if (actions.canAllIn) {
            actionItems.push(`<button class="games-action-btn games-danger" data-action="allin">全下</button>`);
        }
        if (actions.canFold) {
            actionItems.push(`<button class="games-action-btn games-muted" data-action="fold">弃牌</button>`);
        }

        return `
            <div class="games-action-entry">
                <button id="games-log-toggle" class="games-log-toggle ${this._logPanelOpen ? 'is-open' : ''}" type="button" aria-expanded="${this._logPanelOpen ? 'true' : 'false'}" title="回合记录">
                    <i class="fa-solid fa-bell"></i>
                </button>
                <input
                    id="games-action-input"
                    class="games-action-input"
                    type="text"
                    autocomplete="off"
                    placeholder="输入消息"
                    value="${inputValue}">
                <button id="games-action-toggle" class="games-action-toggle ${this._actionPanelOpen ? 'is-open' : ''}" type="button" aria-expanded="${this._actionPanelOpen ? 'true' : 'false'}">
                    <i class="fa-solid fa-clone"></i>
                </button>
            </div>
            <div class="games-bottom-float-layer">
                ${logSheet}
                <div class="games-action-sheet ${this._actionPanelOpen ? 'is-open' : ''}" id="games-action-sheet">
                    <div class="games-actions">
                        ${actionItems.join('')}
                    </div>
                </div>
            </div>
        `;
    }

    _renderLog(state) {
        const lines = (state.log || []).slice(-5).reverse();
        return `
            <div class="games-log-sheet ${this._logPanelOpen ? 'is-open' : ''}" id="games-log-sheet">
                <div class="games-log">
                ${lines.map(line => `<div>${this._escape(line)}</div>`).join('')}
                </div>
            </div>
        `;
    }

    _bindLobbyEvents() {
        document.getElementById('games-back-home')?.addEventListener('click', () => {
            this.app.removePhoneChromeTheme();
            window.dispatchEvent(new CustomEvent('phone:goHome'));
        });
        document.getElementById('games-open-poker')?.addEventListener('click', () => {
            this.openPokerSetupOverlay();
        });
        document.getElementById('games-poker-setup-cancel')?.addEventListener('click', () => {
            this._setupOpen = false;
            this.renderLobby();
        });
        document.getElementById('games-setup-overlay')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-setup-overlay') return;
            this._setupOpen = false;
            this.renderLobby();
        });
        this._bindPokerSetupEvents();
    }

    _bindPokerSetupEvents() {
        document.querySelectorAll('.games-player-count-btn[data-player-count]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.gamesData.setSelectedPlayerCount(Number(btn.dataset.playerCount || 5));
                this.renderLobby();
            });
        });
        document.querySelectorAll('.games-player-count-btn[data-chips-mode]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.app.gamesData.setChipsMode(String(btn.dataset.chipsMode || 'equal'));
                this.renderLobby();
            });
        });
        document.getElementById('games-start-poker')?.addEventListener('click', () => {
            this._setupOpen = false;
            this.app.startPokerGame(this.app.gamesData.getSelectedPlayerCount());
        });
    }

    _bindPokerEvents() {
        document.getElementById('games-back-lobby')?.addEventListener('click', () => {
            this.app.backToLobby();
        });
        document.getElementById('games-next-hand')?.addEventListener('click', () => {
            this.app.gamesData.startNewHand();
            this.renderPoker();
        });
        const logToggle = document.getElementById('games-log-toggle');
        const actionInput = document.getElementById('games-action-input');
        const actionToggle = document.getElementById('games-action-toggle');
        logToggle?.addEventListener('click', () => {
            const nextOpen = !this._logPanelOpen;
            this._logPanelOpen = nextOpen;
            if (nextOpen) this._actionPanelOpen = false;
            this.renderPoker();
        });
        actionInput?.addEventListener('input', () => {
            this._pendingChatInput = String(actionInput.value || '');
        });
        actionToggle?.addEventListener('click', () => {
            const nextOpen = !this._actionPanelOpen;
            this._actionPanelOpen = nextOpen;
            if (nextOpen) this._logPanelOpen = false;
            this._wagerModalOpen = false;
            this.renderPoker();
        });
        document.querySelectorAll('.games-action-btn[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                if (btn.dataset.openWager === '1') {
                    const action = String(btn.dataset.action || '');
                    const defaultAmount = Number(btn.dataset.defaultAmount || 0);
                    const maxAmount = Number(btn.dataset.maxAmount || defaultAmount);
                    const useRandom = btn.dataset.randomWager === '1';
                    const initialAmount = useRandom
                        ? this._randomInt(defaultAmount, Math.max(defaultAmount, maxAmount))
                        : defaultAmount;
                    this._openWagerModal(action, defaultAmount, initialAmount);
                    return;
                }
                const action = btn.dataset.action;
                this._actionPanelOpen = false;
                this._wagerModalOpen = false;
                this.app.gamesData.userAction(action, Number(btn.dataset.amount || 0));
                this.renderPoker();
            });
        });

        document.getElementById('games-wager-modal-cancel')?.addEventListener('click', () => {
            this._wagerModalOpen = false;
            this.renderPoker();
        });
        document.getElementById('games-wager-modal-send')?.addEventListener('click', () => {
            const amount = this._resolveModalWagerAmount();
            this._actionPanelOpen = false;
            this._wagerModalOpen = false;
            this.app.gamesData.userAction(this._wagerModalAction, amount);
            this.renderPoker();
        });
        document.getElementById('games-wager-modal-input')?.addEventListener('input', e => {
            this._wagerModalValue = String(e?.target?.value || '');
        });
        document.getElementById('games-wager-modal-backdrop')?.addEventListener('click', e => {
            if (e.target?.id !== 'games-wager-modal-backdrop') return;
            this._wagerModalOpen = false;
            this.renderPoker();
        });
    }

    _openWagerModal(action, defaultAmount, initialAmount) {
        this._wagerModalAction = action;
        this._wagerModalDefault = Number(defaultAmount || 0);
        this._wagerModalValue = String(initialAmount || this._wagerModalDefault || '');
        this._actionPanelOpen = false;
        this._wagerModalOpen = true;
        this.renderPoker();
    }

    _resolveModalWagerAmount() {
        const raw = String(document.getElementById('games-wager-modal-input')?.value || this._wagerModalValue || '').trim();
        this._wagerModalValue = raw;
        const numeric = raw.replace(/[^\d]/g, '');
        const requestedAmount = numeric ? Number(numeric) : this._wagerModalDefault;
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return this._wagerModalDefault;
        return requestedAmount;
    }

    _randomInt(minValue, maxValue) {
        const min = Math.max(1, Math.floor(Number(minValue) || 1));
        const max = Math.max(min, Math.floor(Number(maxValue) || min));
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    _renderWagerModal() {
        if (!this._wagerModalOpen) return '';
        const title = this._wagerModalAction === 'raise' ? '输入加注金额' : '输入下注金额';
        return `
            <div class="games-wager-modal-backdrop" id="games-wager-modal-backdrop">
                <div class="games-wager-modal">
                    <div class="games-wager-modal-title">${title}</div>
                    <input id="games-wager-modal-input" class="games-wager-modal-input" type="text" inputmode="numeric" autocomplete="off" value="${this._escape(this._wagerModalValue)}">
                    <div class="games-wager-modal-actions">
                        <button id="games-wager-modal-cancel" class="games-player-count-btn" type="button">取消</button>
                        <button id="games-wager-modal-send" class="games-primary-btn games-wager-send-btn" type="button">发送</button>
                    </div>
                </div>
            </div>
        `;
    }

    _loadCSS() {
        if (this._cssLoaded) return;
        if (document.getElementById('games-css')) {
            this._cssLoaded = true;
            return;
        }
        const link = document.createElement('link');
        link.id = 'games-css';
        link.rel = 'stylesheet';
        link.href = new URL('./games.css?v=1.0.0', import.meta.url).href;
        document.head.appendChild(link);
        this._cssLoaded = true;
    }

    _user(state) {
        return state.players.find(player => player.id === 'user');
    }

    _fmt(value) {
        return Number(value || 0).toLocaleString('zh-CN');
    }

    _escape(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

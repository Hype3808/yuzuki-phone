/* ========================================================
 *  柚月小手机 (Yuzuki's Little Phone)
 * ======================================================== */

const SUITS = [
    { id: 'spades', symbol: '♠', color: 'black' },
    { id: 'hearts', symbol: '♥', color: 'red' },
    { id: 'diamonds', symbol: '♦', color: 'red' },
    { id: 'clubs', symbol: '♣', color: 'black' }
];

const RANKS = [
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '4', value: 4 },
    { label: '5', value: 5 },
    { label: '6', value: 6 },
    { label: '7', value: 7 },
    { label: '8', value: 8 },
    { label: '9', value: 9 },
    { label: '10', value: 10 },
    { label: 'J', value: 11 },
    { label: 'Q', value: 12 },
    { label: 'K', value: 13 },
    { label: 'A', value: 14 }
];

const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];
const STREET_LABELS = {
    preflop: '翻牌前',
    flop: '翻牌圈',
    turn: '转牌圈',
    river: '河牌圈',
    showdown: '摊牌'
};

const HAND_LABELS = [
    '高牌',
    '一对',
    '两对',
    '三条',
    '顺子',
    '同花',
    '葫芦',
    '四条',
    '同花顺'
];

export class GamesData {
    constructor(storage) {
        this.storage = storage;
        this.playerCount = this._normalizePlayerCount(Number(this.storage?.get?.('games_poker_player_count')) || 5);
        this.chipsMode = this._normalizeChipsMode(String(this.storage?.get?.('games_poker_chips_mode') || 'equal'));
        this.state = null;
    }

    startPokerGame(playerCount = this.playerCount) {
        this.playerCount = this._normalizePlayerCount(playerCount);
        this.storage?.set?.('games_poker_player_count', this.playerCount, true);
        this.storage?.set?.('games_poker_chips_mode', this.chipsMode, true);
        return this.startNewHand({ resetHandNo: true });
    }

    startNewHand(options = {}) {
        const savedBankroll = Number(this.storage?.get?.('games_poker_user_chips'));
        const startingChips = 3000;
        const userName = this._getWechatUserName();
        const seatMap = this._getSeatMap(this.playerCount);
        const chipsPack = this._buildStartingChips(startingChips, this.playerCount, options.resetHandNo);
        const playerPool = [
            { id: 'user', name: userName, role: 'user', style: 'balanced', chips: chipsPack.userChips, seat: 0 },
            { id: 'laomao', name: '老猫', role: 'ai', style: 'tricky', chips: chipsPack.aiChips[0] ?? startingChips, seat: 1 },
            { id: 'suanpan', name: '算盘', role: 'ai', style: 'tight', chips: chipsPack.aiChips[1] ?? startingChips, seat: 2 },
            { id: 'hongjie', name: '红姐', role: 'ai', style: 'aggressive', chips: chipsPack.aiChips[2] ?? startingChips, seat: 3 },
            { id: 'xiaobai', name: '小白', role: 'ai', style: 'loose', chips: chipsPack.aiChips[3] ?? startingChips, seat: 4 },
            { id: 'heiqi', name: '黑棋', role: 'ai', style: 'tight', chips: chipsPack.aiChips[4] ?? startingChips, seat: 5 }
        ];
        const players = playerPool.slice(0, this.playerCount).map((player, index) => ({ ...player, seat: seatMap[index] ?? index }));

        this.state = {
            handNo: options.resetHandNo ? 1 : (this.state?.handNo || 0) + 1,
            deck: this._shuffle(this._createDeck()),
            street: 'preflop',
            dealerIndex: this.state ? (this.state.dealerIndex + 1) % players.length : 0,
            smallBlind: 25,
            bigBlind: 50,
            minRaise: 50,
            currentBet: 0,
            pot: 0,
            sidePots: [],
            community: [],
            players,
            activePlayerId: 'user',
            phase: 'playing',
            message: '新牌局开始，底牌已发出。',
            dealerMessage: '',
            log: []
        };

        this.state.players.forEach(player => {
            player.cards = [this._draw(), this._draw()];
            player.bet = 0;
            player.totalCommitted = 0;
            player.folded = false;
            player.allIn = false;
            player.acted = false;
            player.status = '';
            player.bestHand = null;
        });

        this._postBlinds();
        this._dealerSay(`第 ${this.state.handNo} 局开始。小盲 ${this.state.smallBlind}，大盲 ${this.state.bigBlind}，底牌已发出。`);
        this._setFirstActor();
        this._runAiUntilUser();
        return this.getState();
    }

    getState() {
        return this.state;
    }

    getSelectedPlayerCount() {
        return this.playerCount;
    }

    setSelectedPlayerCount(playerCount) {
        this.playerCount = this._normalizePlayerCount(playerCount);
        this.storage?.set?.('games_poker_player_count', this.playerCount, true);
        return this.playerCount;
    }

    getChipsMode() {
        return this.chipsMode;
    }

    setChipsMode(mode) {
        this.chipsMode = this._normalizeChipsMode(mode);
        this.storage?.set?.('games_poker_chips_mode', this.chipsMode, true);
        return this.chipsMode;
    }

    getUserActions() {
        const user = this._user();
        if (!user || this.state.phase !== 'playing' || this.state.activePlayerId !== 'user') {
            return { canCheck: false, canCall: false, canBet: false, canRaise: false, canAllIn: false, canFold: false, callAmount: 0 };
        }
        const callAmount = Math.max(0, this.state.currentBet - user.bet);
        return {
            canCheck: callAmount === 0,
            canCall: callAmount > 0 && user.chips > 0,
            canBet: this.state.currentBet === 0 && user.chips > 0,
            canRaise: this.state.currentBet > 0 && user.chips > callAmount,
            canAllIn: user.chips > 0,
            canFold: true,
            callAmount
        };
    }

    userAction(type, amount = 0) {
        const user = this._user();
        if (!user || this.state.phase !== 'playing' || this.state.activePlayerId !== 'user') return this.getState();

        if (type === 'fold') {
            this._fold(user);
        } else if (type === 'check') {
            if (this.state.currentBet > user.bet) return this.getState();
            this._check(user);
        } else if (type === 'call') {
            this._call(user);
        } else if (type === 'bet') {
            this._betOrRaise(user, Math.max(this.state.bigBlind, Number(amount) || this.state.bigBlind));
        } else if (type === 'raise') {
            this._betOrRaise(user, Math.max(this.state.currentBet + this.state.minRaise, Number(amount) || this.state.currentBet + this.state.minRaise));
        } else if (type === 'allin') {
            this._allIn(user);
        }

        this._afterAction(user);
        this._runAiUntilUser();
        this._persistUserChips();
        return this.getState();
    }

    _createDeck() {
        const deck = [];
        SUITS.forEach(suit => {
            RANKS.forEach(rank => {
                deck.push({ suit: suit.id, suitSymbol: suit.symbol, color: suit.color, rank: rank.label, value: rank.value });
            });
        });
        return deck;
    }

    _normalizePlayerCount(playerCount) {
        return Math.max(2, Math.min(6, Math.round(Number(playerCount) || 5)));
    }

    _normalizeChipsMode(mode) {
        const normalized = String(mode || '').trim().toLowerCase();
        return normalized === 'random' ? 'random' : 'equal';
    }

    _buildStartingChips(baseChips, playerCount, isFreshStart = false) {
        const safeBase = Math.max(1000, Math.round(Number(baseChips) || 3000));
        const savedUser = Number(this.storage?.get?.('games_poker_user_chips'));
        const userChips = Number.isFinite(savedUser) && savedUser > 0 && !isFreshStart ? savedUser : safeBase;

        const aiCount = Math.max(0, this._normalizePlayerCount(playerCount) - 1);
        if (this.chipsMode === 'random') {
            const min = Math.max(1000, Math.round(safeBase * 0.75));
            const max = Math.max(min + 100, Math.round(safeBase * 1.35));
            const step = 50;
            const aiChips = Array.from({ length: aiCount }, () => {
                const raw = Math.floor(Math.random() * ((max - min) / step + 1)) * step + min;
                return raw;
            });
            return { userChips, aiChips };
        }

        return { userChips, aiChips: Array.from({ length: aiCount }, () => safeBase) };
    }

    _getWechatUserName() {
        const vp = typeof window !== 'undefined' ? window.VirtualPhone : null;
        const candidates = [
            vp?.cachedWechatData?.getUserInfo?.()?.name,
            vp?.wechatApp?.wechatData?.getUserInfo?.()?.name
        ];

        const raw = this.storage?.get?.('wechat_data', false);
        if (raw) {
            try {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                candidates.push(parsed?.userInfo?.name);
            } catch (e) {
                // ignore bad legacy data
            }
        }

        return String(candidates.find(name => String(name || '').trim()) || '你').trim();
    }

    _getSeatMap(playerCount) {
        const maps = {
            2: [0, 2],
            3: [0, 1, 3],
            4: [0, 1, 2, 3],
            5: [0, 1, 2, 3, 4],
            6: [0, 1, 2, 3, 4, 5]
        };
        return maps[this._normalizePlayerCount(playerCount)] || maps[5];
    }

    _shuffle(deck) {
        const next = [...deck];
        for (let i = next.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [next[i], next[j]] = [next[j], next[i]];
        }
        return next;
    }

    _draw() {
        return this.state.deck.pop();
    }

    _postBlinds() {
        const sb = this.state.players[(this.state.dealerIndex + 1) % this.state.players.length];
        const bb = this.state.players[(this.state.dealerIndex + 2) % this.state.players.length];
        this._commit(sb, this.state.smallBlind);
        sb.status = '小盲';
        this._commit(bb, this.state.bigBlind);
        bb.status = '大盲';
        this.state.currentBet = Math.max(sb.bet, bb.bet);
        this.state.log.push(`${sb.name} 下小盲 ${sb.bet}`);
        this.state.log.push(`${bb.name} 下大盲 ${bb.bet}`);
    }

    _dealerSay(message) {
        const text = String(message || '').trim();
        if (!text) return;
        this.state.dealerMessage = text;
        this.state.message = text;
    }

    _setFirstActor() {
        const start = (this.state.dealerIndex + 3) % this.state.players.length;
        this.state.activePlayerId = this._nextActionPlayerFrom(start - 1)?.id || 'user';
    }

    _commit(player, amount) {
        const paid = Math.max(0, Math.min(player.chips, Math.round(amount)));
        player.chips -= paid;
        player.bet += paid;
        player.totalCommitted += paid;
        this.state.pot += paid;
        if (player.chips <= 0) {
            player.chips = 0;
            player.allIn = true;
            player.status = '全下';
        }
        return paid;
    }

    _fold(player) {
        player.folded = true;
        player.acted = true;
        player.status = '弃牌';
        this.state.log.push(`${player.name} 弃牌`);
    }

    _check(player) {
        player.acted = true;
        player.status = '过牌';
        this.state.log.push(`${player.name} 过牌`);
    }

    _call(player) {
        const need = Math.max(0, this.state.currentBet - player.bet);
        const paid = this._commit(player, need);
        player.acted = true;
        player.status = player.allIn ? '全下' : `跟注 ${paid}`;
        this.state.log.push(`${player.name} 跟注 ${paid}`);
    }

    _betOrRaise(player, targetBet) {
        const nextTarget = Math.max(targetBet, this.state.bigBlind);
        const need = Math.max(0, nextTarget - player.bet);
        const previousBet = this.state.currentBet;
        const paid = this._commit(player, need);
        if (player.bet > this.state.currentBet) {
            this.state.currentBet = player.bet;
            this.state.minRaise = Math.max(this.state.bigBlind, this.state.currentBet - previousBet);
            this._resetOtherActors(player.id);
            player.status = previousBet > 0 ? `加注到 ${player.bet}` : `下注 ${player.bet}`;
            this.state.log.push(`${player.name} ${previousBet > 0 ? '加注到' : '下注'} ${player.bet}`);
        } else {
            player.status = player.allIn ? '全下' : `投入 ${paid}`;
            this.state.log.push(`${player.name} 投入 ${paid}`);
        }
        player.acted = true;
    }

    _allIn(player) {
        const target = player.bet + player.chips;
        this._betOrRaise(player, target);
        player.allIn = true;
        player.status = '全下';
        this.state.log.push(`${player.name} 全下到 ${player.bet}`);
    }

    _afterAction(player) {
        if (this._activePlayers().length <= 1) {
            this._awardLastStanding();
            return;
        }
        if (this._bettingRoundComplete()) {
            this._advanceStreet();
            return;
        }
        this.state.activePlayerId = this._nextActionPlayerFrom(this._playerIndex(player.id))?.id || 'user';
    }

    _runAiUntilUser() {
        let guard = 0;
        while (this.state.phase === 'playing' && this.state.activePlayerId !== 'user' && guard < 80) {
            guard += 1;
            const player = this._player(this.state.activePlayerId);
            if (!player || player.folded || player.allIn) {
                this.state.activePlayerId = this._nextActionPlayerFrom(this._playerIndex(player?.id))?.id || 'user';
                continue;
            }
            this._aiAction(player);
            this._afterAction(player);
        }
        if (this.state.phase === 'playing' && this.state.activePlayerId === 'user') {
            this._dealerSay(this._buildUserPrompt());
        }
    }

    _aiAction(player) {
        const strength = this._estimateStrength(player);
        const need = Math.max(0, this.state.currentBet - player.bet);
        const pressure = need / Math.max(1, player.chips + player.bet);
        const style = player.style;
        let aggression = style === 'aggressive' ? 0.22 : style === 'loose' ? 0.14 : style === 'tricky' ? 0.12 : 0.06;
        let tolerance = style === 'tight' ? -0.12 : style === 'loose' ? 0.12 : style === 'aggressive' ? 0.06 : 0;
        if (style === 'tricky' && Math.random() < 0.18) aggression += 0.22;

        if (need <= 0) {
            if (strength + aggression > 0.72 && player.chips > this.state.bigBlind) {
                this._betOrRaise(player, Math.min(player.chips + player.bet, this.state.bigBlind * (2 + Math.floor(Math.random() * 3))));
            } else {
                this._check(player);
            }
            return;
        }

        if (strength + tolerance < pressure + 0.18 && Math.random() > 0.08) {
            this._fold(player);
            return;
        }

        if (strength + aggression > 0.78 && player.chips > need + this.state.minRaise) {
            const raiseTo = this.state.currentBet + this.state.minRaise * (1 + Math.floor(Math.random() * 3));
            this._betOrRaise(player, Math.min(player.bet + player.chips, raiseTo));
            return;
        }

        this._call(player);
    }

    _estimateStrength(player) {
        const cards = [...player.cards, ...this.state.community];
        if (cards.length >= 5) {
            return Math.min(0.98, this.evaluateBestHand(cards).score / 8 + 0.08);
        }
        const [a, b] = player.cards;
        const high = Math.max(a.value, b.value) / 14;
        const pair = a.value === b.value ? 0.35 : 0;
        const suited = a.suit === b.suit ? 0.08 : 0;
        const connected = Math.abs(a.value - b.value) <= 2 ? 0.08 : 0;
        return Math.min(0.95, 0.16 + high * 0.36 + pair + suited + connected + Math.random() * 0.08);
    }

    _bettingRoundComplete() {
        return this._activePlayers()
            .filter(player => !player.allIn)
            .every(player => player.acted && player.bet === this.state.currentBet);
    }

    _advanceStreet() {
        this._collectSidePots();
        this.state.players.forEach(player => {
            player.bet = 0;
            player.acted = false;
            if (!player.folded && !player.allIn) player.status = '等待';
        });
        this.state.currentBet = 0;
        this.state.minRaise = this.state.bigBlind;

        if (this._activePlayers().filter(player => !player.allIn).length <= 1) {
            while (this.state.community.length < 5) this.state.community.push(this._draw());
            this._showdown();
            return;
        }

        const currentStreetIndex = STREETS.indexOf(this.state.street);
        const nextStreet = STREETS[currentStreetIndex + 1] || 'showdown';
        if (nextStreet === 'flop') {
            this.state.community.push(this._draw(), this._draw(), this._draw());
            this._dealerSay(`翻牌：${this.state.community.slice(0, 3).map(card => `${card.rank}${card.suitSymbol}`).join(' ')}`);
        } else if (nextStreet === 'turn' || nextStreet === 'river') {
            this.state.community.push(this._draw());
            const card = this.state.community[this.state.community.length - 1];
            this._dealerSay(`${nextStreet === 'turn' ? '转牌' : '河牌'}：${card.rank}${card.suitSymbol}`);
        } else {
            this._showdown();
            return;
        }

        this.state.street = nextStreet;
        const first = this._nextActionPlayerFrom(this.state.dealerIndex);
        this.state.activePlayerId = first?.id || 'user';
    }

    _collectSidePots() {
        const committedPlayers = this.state.players.filter(player => player.totalCommitted > 0);
        const levels = [...new Set(committedPlayers.map(player => player.totalCommitted))].sort((a, b) => a - b);
        let previous = 0;
        const sidePots = [];
        levels.forEach(level => {
            const contributors = committedPlayers.filter(player => player.totalCommitted >= level);
            const eligible = contributors.filter(player => !player.folded).map(player => player.id);
            const amount = (level - previous) * contributors.length;
            if (amount > 0 && eligible.length > 0) sidePots.push({ amount, eligible });
            previous = level;
        });
        this.state.sidePots = sidePots;
    }

    _showdown() {
        this._collectSidePots();
        this.state.street = 'showdown';
        this.state.phase = 'showdown';
        const live = this._activePlayers();
        live.forEach(player => {
            player.bestHand = this.evaluateBestHand([...player.cards, ...this.state.community]);
            player.status = player.bestHand.label;
        });

        const awards = [];
        const pots = this.state.sidePots.length ? this.state.sidePots : [{ amount: this.state.pot, eligible: live.map(player => player.id) }];
        pots.forEach(pot => {
            const contenders = pot.eligible.map(id => this._player(id)).filter(Boolean);
            contenders.sort((a, b) => this._compareHands(b.bestHand, a.bestHand));
            const best = contenders[0]?.bestHand;
            const winners = contenders.filter(player => this._compareHands(player.bestHand, best) === 0);
            const share = Math.floor(pot.amount / Math.max(1, winners.length));
            winners.forEach(player => {
                player.chips += share;
                awards.push({ playerId: player.id, name: player.name, amount: share, hand: player.bestHand.label });
            });
        });

        this.state.awards = awards;
        this._dealerSay(`摊牌结束。${awards.map(item => `${item.name} 凭 ${item.hand} 赢得 ${item.amount}`).join('；')}`);
        this._persistUserChips();
    }

    _awardLastStanding() {
        const winner = this._activePlayers()[0];
        if (!winner) return;
        winner.chips += this.state.pot;
        this.state.phase = 'complete';
        this.state.awards = [{ playerId: winner.id, name: winner.name, amount: this.state.pot, hand: '其他玩家弃牌' }];
        this._dealerSay(`${winner.name} 赢得底池 ${this.state.pot}，本局结束。`);
        this._persistUserChips();
    }

    evaluateBestHand(cards) {
        const combos = this._combinations(cards, 5);
        let best = null;
        combos.forEach(combo => {
            const ranked = this._rankFive(combo);
            if (!best || this._compareHands(ranked, best) > 0) best = ranked;
        });
        return best;
    }

    _rankFive(cards) {
        const values = cards.map(card => card.value).sort((a, b) => b - a);
        const counts = new Map();
        values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
        const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
        const flush = cards.every(card => card.suit === cards[0].suit);
        const straightHigh = this._straightHigh(values);

        let score = 0;
        let ranks = [];
        if (flush && straightHigh) {
            score = 8;
            ranks = [straightHigh];
        } else if (groups[0][1] === 4) {
            score = 7;
            ranks = [groups[0][0], ...groups.filter(group => group[1] === 1).map(group => group[0])];
        } else if (groups[0][1] === 3 && groups[1]?.[1] === 2) {
            score = 6;
            ranks = [groups[0][0], groups[1][0]];
        } else if (flush) {
            score = 5;
            ranks = values;
        } else if (straightHigh) {
            score = 4;
            ranks = [straightHigh];
        } else if (groups[0][1] === 3) {
            score = 3;
            ranks = [groups[0][0], ...groups.filter(group => group[1] === 1).map(group => group[0]).sort((a, b) => b - a)];
        } else if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
            score = 2;
            const pairs = groups.filter(group => group[1] === 2).map(group => group[0]).sort((a, b) => b - a);
            const kickers = groups.filter(group => group[1] === 1).map(group => group[0]).sort((a, b) => b - a);
            ranks = [...pairs, ...kickers];
        } else if (groups[0][1] === 2) {
            score = 1;
            ranks = [groups[0][0], ...groups.filter(group => group[1] === 1).map(group => group[0]).sort((a, b) => b - a)];
        } else {
            ranks = values;
        }

        return { score, ranks, label: this._handLabel(score, ranks), cards };
    }

    _straightHigh(values) {
        const unique = [...new Set(values)].sort((a, b) => b - a);
        if (unique.includes(14)) unique.push(1);
        for (let i = 0; i <= unique.length - 5; i += 1) {
            const window = unique.slice(i, i + 5);
            if (window[0] - window[4] === 4) return window[0] === 1 ? 5 : window[0];
        }
        return 0;
    }

    _compareHands(a, b) {
        if (!a || !b) return a ? 1 : b ? -1 : 0;
        if (a.score !== b.score) return a.score - b.score;
        const len = Math.max(a.ranks.length, b.ranks.length);
        for (let i = 0; i < len; i += 1) {
            const diff = (a.ranks[i] || 0) - (b.ranks[i] || 0);
            if (diff !== 0) return diff;
        }
        return 0;
    }

    _handLabel(score, ranks) {
        const rankText = this._rankName(ranks[0]);
        if (score === 8) return `${rankText}高同花顺`;
        if (score === 7) return `四条${rankText}`;
        if (score === 6) return `${rankText}葫芦`;
        if (score === 4) return `${rankText}高顺子`;
        if (score === 3) return `三条${rankText}`;
        if (score === 2) return `两对${this._rankName(ranks[0])}/${this._rankName(ranks[1])}`;
        if (score === 1) return `一对${rankText}`;
        return score === 5 ? `${rankText}高同花` : `${rankText}高牌`;
    }

    _rankName(value) {
        return RANKS.find(rank => rank.value === value)?.label || String(value);
    }

    _combinations(items, size) {
        const result = [];
        const walk = (start, combo) => {
            if (combo.length === size) {
                result.push(combo);
                return;
            }
            for (let i = start; i < items.length; i += 1) {
                walk(i + 1, [...combo, items[i]]);
            }
        };
        walk(0, []);
        return result;
    }

    _resetOtherActors(actorId) {
        this.state.players.forEach(player => {
            if (player.id !== actorId && !player.folded && !player.allIn) player.acted = false;
        });
    }

    _nextActionPlayerFrom(index) {
        for (let offset = 1; offset <= this.state.players.length; offset += 1) {
            const player = this.state.players[(index + offset + this.state.players.length) % this.state.players.length];
            if (player && !player.folded && !player.allIn) return player;
        }
        return null;
    }

    _activePlayers() {
        return this.state.players.filter(player => !player.folded);
    }

    _player(id) {
        return this.state.players.find(player => player.id === id) || null;
    }

    _user() {
        return this._player('user');
    }

    _playerIndex(id) {
        return this.state.players.findIndex(player => player.id === id);
    }

    _buildUserPrompt() {
        const user = this._user();
        const need = Math.max(0, this.state.currentBet - user.bet);
        if (need > user.chips) return `您无法跟注 ${need}，可选择全下或弃牌。`;
        if (need > 0) return `轮到你行动，最低跟注 ${need}。`;
        return '轮到你行动，可以过牌或下注。';
    }

    _persistUserChips() {
        const user = this._user();
        if (user && this.storage?.set) this.storage.set('games_poker_user_chips', user.chips, true);
    }
}

export { STREET_LABELS, HAND_LABELS };

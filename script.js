// 1. إعدادات Firebase (Hardcoded للعمل المباشر)
const firebaseConfig = {
    apiKey: "AIzaSyBvWGwTwzWztUystFa_PiASBM1_zKYljgE",
    authDomain: "gunter-9588f.firebaseapp.com",
    projectId: "gunter-9588f",
    storageBucket: "gunter-9588f.appspot.com",
    databaseURL: "https://gunter-9588f-default-rtdb.europe-west1.firebasedatabase.app"
};

// تهيئة Firebase
if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 2. المتغيرات العامة
let game = new Chess();
let board = null;
let roomId = null;
let myColor = 'white';
let selectedMinutes = 1;
let isGameActive = false;
let timerInterval = null;
let localTimers = { white: 60, black: 60 };

// 3. واجهة المستخدم - اختيار الوقت
function selectTime(mins) {
    selectedMinutes = mins;
    // إزالة التحديد عن الكل
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('selected'));
    // تحديد الزر المختار
    document.getElementById('t-' + mins).classList.add('selected');
}

// 4. إنشاء لعبة جديدة
function createGame() {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    myColor = 'white';
    
    // بيانات الغرفة الأولية
    const initialData = {
        fen: game.fen(),
        turn: 'white',
        status: 'waiting', // حالة انتظار الخصم
        timers: { white: selectedMinutes * 60, black: selectedMinutes * 60 },
        lastMoveTime: Date.now(),
        players: { white: true, black: false }
    };

    // إرسال لـ Firebase
    db.ref('rooms/' + roomId).set(initialData).then(() => {
        setupBoard('white');
        showPage('game-page');
        
        // إظهار نافذة الانتظار
        document.getElementById('waiting-overlay').style.display = 'flex';
        document.getElementById('display-code').innerText = roomId;
        
        listenToRoom();
    });
}

// 5. الانضمام للعبة
function joinGame() {
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!code) return alert('الرجاء إدخال الكود');

    db.ref('rooms/' + code).once('value').then(snapshot => {
        if (!snapshot.exists()) return alert('الغرفة غير موجودة');
        const data = snapshot.val();
        if (data.players.black) return alert('الغرفة ممتلئة');

        roomId = code;
        myColor = 'black';

        // تحديث الغرفة: دخول اللاعب الثاني وبدء اللعب
        db.ref('rooms/' + roomId).update({
            'players/black': true,
            'status': 'active',
            'lastMoveTime': Date.now()
        }).then(() => {
            setupBoard('black');
            showPage('game-page');
            document.getElementById('waiting-overlay').style.display = 'none';
            listenToRoom();
        });
    });
}

// 6. إعداد الرقعة (Board)
function setupBoard(orientation) {
    if (board) board.destroy();
    
    game = new Chess(); // إعادة ضبط منطق اللعبة
    
    const config = {
        draggable: true,
        position: 'start',
        orientation: orientation,
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: () => board.position(game.fen())
    };
    
    // تهيئة المكتبة
    board = Chessboard2('board', config);
    
    // مهم جداً: إعادة رسم البورد عند تغيير حجم النافذة لضمان التجاوب
    window.addEventListener('resize', board.resize);
    
    // منع التمرير عند لمس البورد (للموبايل)
    const boardEl = document.getElementById('board');
    boardEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}

// 7. الاستماع لتحديثات السيرفر
function listenToRoom() {
    db.ref('rooms/' + roomId).on('value', snapshot => {
        const data = snapshot.val();
        if (!data) return;

        // أ. حالة الاتصال
        if (data.status === 'active') {
            // إذا كنت المضيف واللعبة كانت في انتظار، قم بإخفاء الانتظار
            if (document.getElementById('waiting-overlay').style.display !== 'none') {
                document.getElementById('waiting-overlay').style.display = 'none';
            }
            
            document.getElementById('opponent-status').innerText = 'متصل';
            document.getElementById('opponent-status').style.color = '#4cc9f0';
            
            if (!isGameActive) {
                isGameActive = true;
                startLocalTimer();
            }
        }

        // ب. تحديث الحركات
        if (data.fen !== game.fen()) {
            game.load(data.fen);
            board.position(data.fen);
            updateStatus();
            playMoveSound(); // اختياري: صوت حركة
        }

        // ج. تحديث التوقيت
        localTimers = data.timers;
        updateTimerDisplay();
    });
}

// 8. منطق الحركات (التحقق والإرسال)
function removeHighlights() {
    $('.legal-dot').remove();
}

function onDragStart(source, piece) {
    if (!isGameActive || game.game_over()) return false;

    // منع تحريك قطع الخصم
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) return false;

    // منع اللعب في غير دورك
    if ((game.turn() === 'w' && myColor === 'black') ||
        (game.turn() === 'b' && myColor === 'white')) return false;

    // إظهار النقاط الخضراء للحركات المتاحة
    const moves = game.moves({ square: source, verbose: true });
    if (moves.length === 0) return;

    moves.forEach(move => {
        // إضافة عنصر نقطة داخل المربع المتاح
        const squareEl = document.querySelector(`.square-${move.to}`);
        if (squareEl) {
            const dot = document.createElement('div');
            dot.className = 'legal-dot';
            squareEl.appendChild(dot);
        }
    });
}

function onDrop(source, target) {
    removeHighlights();

    const move = game.move({
        from: source,
        to: target,
        promotion: 'q' // ترقية تلقائية للوزير
    });

    if (move === null) return 'snapback';

    updateServerAfterMove(move);
    updateStatus();
}

function updateServerAfterMove(move) {
    const now = Date.now();
    db.ref('rooms/' + roomId).transaction(room => {
        if (room) {
            const elapsed = Math.floor((now - room.lastMoveTime) / 1000);
            const turnColor = move.color === 'w' ? 'white' : 'black';
            
            // خصم الوقت
            const newTime = Math.max(0, room.timers[turnColor] - elapsed);
            
            room.fen = game.fen();
            room.turn = game.turn() === 'w' ? 'white' : 'black';
            room.lastMoveTime = now;
            room.timers[turnColor] = newTime;
            return room;
        }
    });
}

// 9. إدارة الوقت
function startLocalTimer() {
    if (timerInterval) clearInterval(timerInterval);
    
    timerInterval = setInterval(() => {
        if (game.game_over()) return;

        const turn = game.turn() === 'w' ? 'white' : 'black';
        if (localTimers[turn] > 0) {
            localTimers[turn]--;
            updateTimerDisplay();
        } else {
            clearInterval(timerInterval);
            // يمكن إضافة منطق إعلان الخسارة بالوقت هنا
        }
    }, 1000);
}

function updateTimerDisplay() {
    const format = t => {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // تحديث وقتي
    const myTimeEl = document.getElementById('timer-self');
    myTimeEl.innerText = format(localTimers[myColor]);
    if (localTimers[myColor] < 10) myTimeEl.classList.add('low-time');
    else myTimeEl.classList.remove('low-time');

    // تحديث وقت الخصم
    const oppColor = myColor === 'white' ? 'black' : 'white';
    document.getElementById('timer-opponent').innerText = format(localTimers[oppColor]);
}

// 10. دوال مساعدة
function showPage(id) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function copyCode() {
    navigator.clipboard.writeText(roomId).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> تم النسخ!';
        setTimeout(() => btn.innerHTML = originalText, 2000);
    });
}

function updateStatus() {
    let status = '';
    if (game.in_checkmate()) status = 'كش مات! انتهت اللعبة';
    else if (game.in_draw()) status = 'تعادل!';
    else if (game.in_check()) status = '!! كش ملك !!';
    
    document.getElementById('status-msg').innerText = status;
}

function playMoveSound() {
    // يمكن إضافة ملف صوتي هنا مستقبلاً
}

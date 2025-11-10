// DOM(HTML 요소) 로드 완료 후 스크립트 실행
window.addEventListener('DOMContentLoaded', () => {

    // --- 1. 상수 및 변수 정의 ---

    // localStorage 키
    const LS_USER_KEY = 'tetrisPuzzleUser';
    const LS_GAME_DATA_KEY = 'tetrisPuzzleGameData';

    // 게임 보드 설정
    const COLS = 10;
    const ROWS = 20;
    const BLOCK_SIZE = 30; // 픽셀 단위

    // 캔버스 및 컨텍스트
    const boardCanvas = document.getElementById('tetris-board');
    const boardCtx = boardCanvas.getContext('2d');
    boardCanvas.width = COLS * BLOCK_SIZE;
    boardCanvas.height = ROWS * BLOCK_SIZE;

    const nextCanvas = document.getElementById('next-block');
    const nextCtx = nextCanvas.getContext('2d');
    nextCanvas.width = 4 * (BLOCK_SIZE - 5); // 100
    nextCanvas.height = 3 * (BLOCK_SIZE - 5); // 75

    // 블록 색상 및 모양 (테트로미노)
    const COLORS = [
        null, 'cyan', 'blue', 'orange', 'yellow', 'green', 'purple', 'red'
    ];
    const SHAPES = [
        null,
        [[0,0,0,0], [1,1,1,1], [0,0,0,0], [0,0,0,0]], // I
        [[2,0,0], [2,2,2], [0,0,0]], // J
        [[0,0,3], [3,3,3], [0,0,0]], // L
        [[4,4], [4,4]], // O
        [[0,5,5], [5,5,0], [0,0,0]], // S
        [[0,6,0], [6,6,6], [0,0,0]], // T
        [[7,7,0], [0,7,7], [0,0,0]]  // Z
    ];

    // 게임 상태 변수
    let board = []; // 2D 배열로 게임 보드 상태 저장
    let currentPiece;
    let nextPiece;
    let score = 0;
    let linesClearedThisStage = 0;
    let gameLoopId;
    let lastDropTime = 0;
    let dropInterval = 1000; // 1초 (난이도에 따라 변경됨)

    // 유저 및 데이터
    let currentPlayer = null; // { id: "유저명", difficulty: "easy/medium/hard" }
    let gameData = {}; // { "유저ID": { lastPlayed: "YYYY-MM-DD", attempts: 10, stages: { "stage1": { cleared: true, score: 500 } } } }
    let currentStage = null; // 현재 플레이 중인 스테이지 데이터
    let selectedAvatar = null; // [신설] 유저 생성 시 선택한 아바타
    let selectedUserForLogin = null; // [신설] 로그인 시도 중인 유저 ID

    // DOM 요소 캐시
    const screens = {
        start: document.getElementById('start-screen'),
        user: document.getElementById('user-screen'),
        stageSelect: document.getElementById('stage-select-screen'),
        game: document.getElementById('game-screen')
    };
    const modals = {
        overlay: document.getElementById('modal-overlay'),
        stageClear: document.getElementById('stage-clear-modal'),
        gameOver: document.getElementById('game-over-modal'),
        noAttempts: document.getElementById('no-attempts-modal'),
        passwordLogin: document.getElementById('password-login-modal') // [신설]
    };

    // [신설] 스테이지 번호를 기반으로 스테이지 데이터를 동적으로 생성합니다.
    function generateStageData(stageNumber) {
        const stageId = 'stage' + stageNumber;

        // 1. 목표 생성
        // 예: 2 레벨마다 목표 라인 1씩 증가, 최대 4줄(테트리스)
        const goalCount = Math.min(Math.floor(stageNumber / 2) + 1, 4);
        const goal = { type: 'clear_lines', count: goalCount };

        // 2. 초기 보드(방해 블록) 생성
        const board = createEmptyBoard(); // 일단 빈 보드 생성

        // 예: 3 레벨마다 방해 블록 1줄씩 증가, 최대 10줄
        const numGarbageLines = Math.min(Math.floor(stageNumber / 3), 10);

        if (numGarbageLines > 0) {
            let lastHolePos = -1;
            for (let i = 0; i < numGarbageLines; i++) {
                // 방해 블록은 7번(red)으로 통일
                const line = Array(COLS).fill(7);

                // 구멍 위치: 지난번 구멍과 겹치지 않도록 (단순 로직)
                let holePos;
                do {
                    holePos = Math.floor(Math.random() * COLS);
                } while (holePos === lastHolePos && COLS > 1);

                line[holePos] = 0; // 구멍 뚫기
                lastHolePos = holePos;

                // 보드 맨 아래(ROWS - 1)부터 위로 채우기
                const rowIndex = (ROWS - 1) - i;
                board[rowIndex] = line;
            }
        }

        // 3. 생성된 스테이지 객체 반환
        return {
            id: stageId,
            goal: goal,
            initialBoard: board
        };
    }

    // --- 3. 핵심 유틸리티 함수 ---

    /**
     * 지정된 ID의 화면만 보여주고 나머지는 숨깁니다.
     * @param {string} screenId ('start', 'user', 'stageSelect', 'game')
     */
    function showScreen(screenId) {
        Object.values(screens).forEach(screen => screen.classList.remove('active'));
        screens[screenId].classList.add('active');
    }

    /**
     * 지정된 ID의 모달을 보여줍니다.
     * @param {string} modalId ('stageClear', 'gameOver', 'noAttempts')
     */
    function showModal(modalId) {
        modals.overlay.style.display = 'flex';

        // 'modals' 객체의 [키, 값] 쌍을 모두 순회합니다.
        // 예: ['stageClear', <div id="stage-clear-modal">]
        Object.entries(modals).forEach(([key, modalElement]) => {

            // 'overlay' 자체는 건너뜁니다.
            if (key === 'overlay') return;

            // 전달된 modalId와 객체의 키가 일치하는지 확인합니다.
            if (key === modalId) {
                // 일치하면(보여줄 모달) -> 'block'
                modalElement.style.display = 'block';
            } else {
                // 일치하지 않으면(숨길 모달) -> 'none'
                modalElement.style.display = 'none';
            }
        });
    }

    // [신설] 유저 목록 화면을 그리고 이벤트를 연결합니다.
    function renderUserListScreen() {
        // 1. 뷰 전환
        document.getElementById('user-list-box').style.display = 'block';
        document.getElementById('user-creation-box').style.display = 'none';

        // 2. 데이터 로드 및 목록 생성
        loadGameData();
        const userListEl = document.getElementById('user-list');
        userListEl.innerHTML = ''; // 비우기

        const userIds = Object.keys(gameData);

        if (userIds.length === 0) {
            userListEl.innerHTML = '<p>등록된 유저가 없습니다. 새 유저를 등록해주세요.</p>';
        } else {
            userIds.forEach(userId => {
                const btn = document.createElement('button');
                btn.className = 'user-select-btn';

                const userData = gameData[userId];
                const difficulty = userData.difficulty || '정보없음';
                const avatar = userData.profilePic || '❔'; // [수정] 프로필 사진 가져오기

                // [수정] 아바타를 포함하도록 innerHTML 변경
                btn.innerHTML = `
                    <span class="user-avatar-display">${avatar}</span>
                    <div>
                        <strong>${userId}</strong>
                        <br>
                        <small>(난이도: ${difficulty})</small>
                    </div>`;

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    handleUserSelect(userId, difficulty);
                });

                userListEl.appendChild(btn);
            });
        }
    }

    // [신설] 기존 유저를 선택했을 때 처리
    // [수정] 기존 유저를 선택했을 때 -> 비밀번호 모달 표시
    function handleUserSelect(userId) {
        // 1. 로그인할 유저 ID 임시 저장
        selectedUserForLogin = userId;
        const userData = gameData[userId];

        // 2. 모달창 정보 채우기
        document.getElementById('password-modal-title').textContent = `${userId}님, 로그인`;
        document.getElementById('password-modal-avatar').textContent = userData.profilePic || '❔';
        document.getElementById('password-modal-input').value = ''; // 입력 필드 비우기
        document.getElementById('password-modal-error').style.display = 'none'; // 에러 메시지 숨기기

        // 3. 모달 표시
        showModal('passwordLogin');
    }

    /**
     * [신설] 비밀번호 모달에서 '로그인' 버튼 클릭 시 실행 (비동기)
     */
    async function handlePasswordLogin() {
        const enteredPassword = document.getElementById('password-modal-input').value;
        const errorEl = document.getElementById('password-modal-error');

        if (!selectedUserForLogin || !enteredPassword) {
            errorEl.textContent = '비밀번호를 입력하세요.';
            errorEl.style.display = 'block';
            return;
        }

        const userData = gameData[selectedUserForLogin];
        const storedHash = userData.passwordHash;

        // 1. 입력된 비밀번호를 해시
        const enteredHash = await hashPassword(enteredPassword);

        // 2. 해시 비교
        if (enteredHash === storedHash) {
            // 로그인 성공
            hideModals();
            // 실제 로그인 처리 및 스테이지 선택 화면으로 이동
            performLogin(selectedUserForLogin, userData.difficulty);
        } else {
            // 로그인 실패
            errorEl.textContent = '비밀번호가 일치하지 않습니다.';
            errorEl.style.display = 'block';
        }
    }

    /**
     * [신설] 실제 로그인 처리를 수행하고 스테이지 화면으로 이동
     */
    function performLogin(userId, difficulty) {
        // 1. 현재 플레이어 설정
        currentPlayer = { id: userId, difficulty: difficulty };

        // 2. 마지막 접속 유저로 저장
        localStorage.setItem(LS_USER_KEY, JSON.stringify(currentPlayer));

        // 3. 스테이지 선택 화면으로 이동
        // (이 함수가 내부적으로 getUserData()를 호출하여 날짜/횟수 갱신)
        renderStageSelectScreen();
    }

    /**
     * [신설] 비밀번호 모달에서 '유저 삭제' 버튼 클릭 시 실행
     */
    function handleDeleteUser() {
        if (!selectedUserForLogin) return;

        // 정말 삭제할지 확인
        if (confirm(`정말로 '${selectedUserForLogin}' 유저를 삭제하시겠습니까?\n모든 스테이지 기록이 사라집니다.`)) {
            // 1. gameData에서 유저 삭제
            delete gameData[selectedUserForLogin];
            saveGameData();

            // 2. 마지막 로그인 유저 정보 삭제
            localStorage.removeItem(LS_USER_KEY);

            // 3. 모달 닫고 유저 목록 새로고침
            hideModals();
            renderUserListScreen();
        }
    }

    /** 모든 모달을 닫습니다. */
    function hideModals() {
        modals.overlay.style.display = 'none';
    }

    /** 오늘 날짜를 'YYYY-MM-DD' 형식으로 반환합니다. */
    function getTodayDate() {
        return new Date().toISOString().split('T')[0];
    }

    /** 빈 게임 보드(2D 배열)를 생성합니다. */
    function createEmptyBoard() {
        return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    }

    /**
     * [신설] 비밀번호를 SHA-256 해시로 변환합니다. (비동기)
     * @param {string} password
     * @returns {Promise<string>} 64글자의 16진수 해시 문자열
     */
    async function hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // 버퍼를 16진수 문자열로 변환
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    // --- 4. 데이터 관리 (localStorage) ---

    /** localStorage에서 전체 게임 데이터를 불러옵니다. */
    function loadGameData() {
        const data = localStorage.getItem(LS_GAME_DATA_KEY);
        gameData = data ? JSON.parse(data) : {};
    }

    /** 전체 게임 데이터를 localStorage에 저장합니다. */
    function saveGameData() {
        localStorage.setItem(LS_GAME_DATA_KEY, JSON.stringify(gameData));
    }

    /**
     * 현재 유저의 데이터를 가져오거나 초기화합니다.
     * 일일 시도 횟수를 체크하고, 날짜가 다르면 리셋합니다.
     */
    function getUserData() {
        const userId = currentPlayer.id;
        if (!gameData[userId]) {
            // 새 유저 데이터 생성
            // (경고: 이 로직은 handleUserLogin에서 이미 처리되므로,
            //        currentPlayer에 passwordHash, profilePic이 없다면 비정상)
            console.warn(`getUserData: ${userId} 데이터가 없습니다. 새로 생성합니다.`);
            gameData[userId] = {
                difficulty: currentPlayer.difficulty,
                profilePic: '❔', // 기본값
                passwordHash: '', // 기본값 (로그인 불가)
                lastPlayed: getTodayDate(),
                attempts: 10,
                stages: {}
            };
        } else {
            // 날짜 확인하여 시도 횟수 리셋
            const today = getTodayDate();
            if (gameData[userId].lastPlayed !== today) {
                gameData[userId].lastPlayed = today;
                gameData[userId].attempts = 10;
            }
        }
        saveGameData();
        return gameData[userId];
    }


    // --- 5. 게임 흐름 관리 (화면 전환) ---

    function init() {
        // 1. 첫 화면 버튼
        document.getElementById('start-game-btn').addEventListener('click', () => {
            showScreen('user');
            renderUserListScreen();
        });

        // 2. 유저 화면 버튼
        document.getElementById('user-confirm-btn').addEventListener('click', handleUserLogin);

        // [신설] '새 유저 등록' 버튼 클릭 시 생성 폼 표시
        document.getElementById('show-new-user-form-btn').addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('user-list-box').style.display = 'none';
            document.getElementById('user-creation-box').style.display = 'block';
        });

        // [신설] '뒤로가기' 버튼 클릭 시 목록 폼 표시
        document.getElementById('back-to-user-list-btn').addEventListener('click', (e) => {
            e.preventDefault();
            renderUserListScreen(); // 목록 화면을 다시 그림
        });

        // [신설] 아바타 선택 이벤트
        document.querySelectorAll('.avatar-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                // 기존 선택 해제
                document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
                // 새 아바타 선택
                e.currentTarget.classList.add('selected');
                selectedAvatar = e.currentTarget.textContent;
            });
        });

        // [신설] 비밀번호 로그인 모달 - '로그인' 버튼
        document.getElementById('password-modal-login-btn').addEventListener('click', (e) => {
            e.preventDefault();
            handlePasswordLogin(); // 비동기 함수 호출
        });

        // [신설] 비밀번호 로그인 모달 - '유저 삭제' 버튼
        document.getElementById('password-modal-delete-btn').addEventListener('click', (e) => {
            e.preventDefault();
            handleDeleteUser();
        });

        // 3. 스테이지 선택 화면 버튼
        document.getElementById('change-user-btn').addEventListener('click', () => {
            localStorage.removeItem(LS_USER_KEY); // 현재 유저 정보 삭제
            currentPlayer = null;
            showScreen('user');
            renderUserListScreen();
        });

        // 4. 게임 화면 버튼
        document.getElementById('back-to-stages-btn').addEventListener('click', () => {
            stopGameLoop();
            renderStageSelectScreen(); // 스테이지 선택 화면으로 돌아가기
        });

        // 5. 모달 닫기 버튼
        document.querySelectorAll('.modal-close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                hideModals();
                renderStageSelectScreen(); // 스테이지 선택 화면으로
            });
        });

        // 6. 스테이지 클리어 -> 다음 스테이지
        document.getElementById('next-stage-btn').addEventListener('click', (e) => {
            e.preventDefault();
            hideModals();

            // [수정] 현재 스테이지 번호를 파싱해서 +1
            const currentNum = parseInt(currentStage.id.replace('stage', ''), 10);
            const nextStageNum = currentNum + 1;
            const nextStageId = 'stage' + nextStageNum;

            // [수정] 99스테이지 초과 방지 (예시)
            if (nextStageNum > 99) { // ABSOLUTE_MAX_STAGE와 동일한 값 사용
                renderStageSelectScreen(); // 마지막 스테이지면 선택화면으로
            } else {
                handleStageStart(nextStageId); // 다음 스테이지 시작
            }
        });

        // 7. 게임 컨트롤러(키보드) 연결
        document.addEventListener('keydown', handleKeyPress);

        // 8. 터치 컨트롤러 연결
        document.getElementById('btn-left').addEventListener('click', () => handleMove(-1));
        document.getElementById('btn-right').addEventListener('click', () => handleMove(1));
        document.getElementById('btn-rotate').addEventListener('click', () => handleRotate());
        document.getElementById('btn-down').addEventListener('click', () => handleDrop());
        document.getElementById('btn-hard-drop').addEventListener('click', () => handleHardDrop());


        // 1단계 시작
        showScreen('start');
    }

    /** 2. (유저 화면) 새 유저 로그인/생성 처리 */
    /** 2. (유저 화면) 새 유저 로그인/생성 처리 */
    /** 2. (유저 화면) 새 유저 로그인/생성 처리 (비동기 함수로 변경) */
    async function handleUserLogin(e) {
        e.preventDefault();

        const userId = document.getElementById('user-id-input').value.trim();
        const password = document.getElementById('user-password-input').value;
        const passwordConfirm = document.getElementById('user-password-confirm').value;
        const difficulty = document.getElementById('age-range-select').value;

        // --- [신설] 유효성 검사 ---
        if (!userId || !password || !passwordConfirm || !selectedAvatar) {
            alert('모든 항목(아이디, 비밀번호, 아바타)을 입력/선택해주세요.');
            return;
        }
        if (password.length < 4) {
            alert('비밀번호는 4자리 이상이어야 합니다.');
            return;
        }
        if (password !== passwordConfirm) {
            alert('비밀번호가 일치하지 않습니다.');
            return;
        }

        loadGameData();
        if (gameData[userId]) {
            alert('이미 존재하는 아이디입니다. 다른 아이디를 입력해주세요.');
            return;
        }

        // --- [신설] 비밀번호 해시 생성 ---
        const passwordHash = await hashPassword(password);

        // 1. 새 유저 데이터 생성 (gameData에)
        gameData[userId] = {
            difficulty: difficulty,
            profilePic: selectedAvatar,
            passwordHash: passwordHash, // 해시된 비밀번호 저장
            lastPlayed: getTodayDate(),
            attempts: 10,
            stages: {}
        };
        saveGameData();

        // 2. 폼 초기화
        document.getElementById('user-id-input').value = '';
        document.getElementById('user-password-input').value = '';
        document.getElementById('user-password-confirm').value = '';
        document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
        selectedAvatar = null;

        // 3. 생성한 유저로 즉시 로그인 및 스테이지 선택 화면 이동
        performLogin(userId, difficulty);
    }

    /** 3. (스테이지 선택 화면) 화면 구성 (동적 생성 방식으로 수정) */
    function renderStageSelectScreen() {
        showScreen('stageSelect');
        const userData = getUserData(); // 시도 횟수 리셋/확인

        document.getElementById('current-user-display').textContent = currentPlayer.id;
        document.getElementById('attempts-display').textContent = userData.attempts;

        const stageList = document.getElementById('stage-list');
        stageList.innerHTML = ''; // 목록 비우기

        // [수정] 유저 데이터에서 최고 클리어 스테이지 번호 찾기
        const userStages = userData.stages || {};
        let highestCleared = 0;
        Object.keys(userStages).forEach(stageId => {
            if (userStages[stageId].cleared) {
                const stageNum = parseInt(stageId.replace('stage', ''), 10);
                if (stageNum > highestCleared) {
                    highestCleared = stageNum;
                }
            }
        });

        // [수정] 스테이지 버튼 생성: (최고 클리어 + 1)까지 생성
        // 최소 5개의 스테이지는 항상 표시
        const maxStageToShow = Math.max(highestCleared + 1, 5);
        const ABSOLUTE_MAX_STAGE = 99; // (무한 생성을 막기 위한 최대 스테이지 제한)

        for (let i = 1; i <= maxStageToShow && i <= ABSOLUTE_MAX_STAGE; i++) {
            const stageId = 'stage' + i;
            const stageResult = userStages[stageId];

            const btn = document.createElement('button');
            btn.textContent = `${i}`; // 스테이지 번호만 표시 (깔끔하게)
            btn.classList.add('stage-btn');

            if (stageResult && stageResult.cleared) {
                btn.classList.add('cleared');
                btn.title = `클리어! (점수: ${stageResult.score})`;
            } else if (i > highestCleared + 1) {
                // [수정] 락(lock) 로직: 최고 클리어 + 1 보다 크면 잠금
                btn.classList.add('locked');
                btn.disabled = true;
            }

            if (!btn.disabled) {
                btn.onclick = () => handleStageStart(stageId);
            }
            stageList.appendChild(btn);
        }
    }

    /** 4. (스테이지 선택) 게임 시작 처리 */
    function handleStageStart(stageId) {
        const userData = getUserData();

        // 1. 시도 횟수 확인
        if (userData.attempts <= 0) {
            showModal('noAttempts');
            return;
        }

        // 2. 시도 횟수 차감
        userData.attempts--;
        saveGameData();

        // 3. 게임 초기화
        const stageNumber = parseInt(stageId.replace('stage', ''), 10);
        currentStage = generateStageData(stageNumber);
        score = 0;
        linesClearedThisStage = 0;

        // 4. 난이도(속도) 설정
        switch (currentPlayer.difficulty) {
            case 'easy': dropInterval = 1000; break;
            case 'medium': dropInterval = 700; break;
            case 'hard': dropInterval = 400; break;
        }

        // 5. 스테이지 초기 보드 설정
        if (currentStage.initialBoard && currentStage.initialBoard.length > 0) {
            // 깊은 복사 (중요)
            board = currentStage.initialBoard.map(row => [...row]);
        } else {
            board = createEmptyBoard();
        }

        // 6. 첫 블록 생성
        // (스테이지 데이터에 블록 순서가 있다면 따르고, 아니면 랜덤)
        nextPiece = getRandomPiece();
        spawnNewPiece();

        // 7. UI 업데이트 및 게임 화면 표시
        updateGameUI();
        showScreen('game');

        // 8. 게임 루프 시작
        startGameLoop();
    }

    /** 5. (게임 종료) 스테이지 클리어 처리 */
    function handleStageClear() {
        stopGameLoop();

        // 데이터 저장
        const userData = getUserData();
        userData.stages[currentStage.id] = { cleared: true, score: score };
        saveGameData();

        // 모달 표시
        document.getElementById('final-score').textContent = score;
        showModal('stageClear');
    }

    /** 6. (게임 종료) 시도 실패(게임 오버) 처리 */
    function handleGameOver() {
        stopGameLoop();
        showModal('gameOver');
        // 시도 횟수는 이미 handleStageStart에서 차감했음
    }


    // --- 6. 코어 테트리스 로직 ---

    /** 새 블록을 생성하고 보드에 배치합니다. */
    function spawnNewPiece() {
        currentPiece = nextPiece;
        nextPiece = getRandomPiece();

        // O 블록(4)은 중앙에서 시작
        currentPiece.x = (currentPiece.shape[0].length === 2) ? 4 : 3;
        currentPiece.y = 0;

        // 스폰 위치에서 충돌 = 게임 오버
        if (checkCollision(currentPiece)) {
            handleGameOver();
        }
    }

    /** 랜덤한 테트로미노 조각을 반환합니다. */
    function getRandomPiece() {
        const type = Math.floor(Math.random() * (SHAPES.length - 1)) + 1;
        const shape = SHAPES[type];
        return {
            shape: shape,
            color: COLORS[type],
            x: 0,
            y: 0
        };
    }

    /** 게임 화면 UI (점수, 목표 등)를 업데이트합니다. */
    function updateGameUI() {
        document.getElementById('current-stage-num').textContent = currentStage.id.replace('stage', '');
        document.getElementById('stage-goal').textContent = `${currentStage.goal.count}줄 제거`;
        document.getElementById('score').textContent = score;
        document.getElementById('attempts-left-game').textContent = gameData[currentPlayer.id].attempts;
        drawNextPiece();
    }

    /** 게임 루프 시작 */
    function startGameLoop() {
        stopGameLoop(); // 만약을 위해 이전 루프 정지
        lastDropTime = Date.now();
        gameLoop();
    }

    /** 게임 루프 정지 */
    function stopGameLoop() {
        if (gameLoopId) {
            cancelAnimationFrame(gameLoopId);
            gameLoopId = null;
        }
    }

    /** 메인 게임 루프 */
    function gameLoop() {
        const now = Date.now();
        const delta = now - lastDropTime;

        if (delta > dropInterval) {
            handleDrop();
            lastDropTime = now;
        }

        drawGame(); // 매 프레임마다 게임 화면 그리기
        gameLoopId = requestAnimationFrame(gameLoop);
    }

    /** (컨트롤) 블록을 아래로 한 칸 내립니다. */
    function handleDrop() {
        if (!currentPiece) return;
        currentPiece.y++;
        if (checkCollision(currentPiece)) {
            currentPiece.y--; // 원위치
            lockPiece(); // 바닥에 닿음
        }
    }

    /** (컨트롤) 블록을 바닥까지 즉시 내립니다. (하드 드롭) */
    function handleHardDrop() {
        if (!currentPiece) return;
        while (!checkCollision(currentPiece)) {
            currentPiece.y++;
        }
        currentPiece.y--; // 충돌 직전 위치로
        lockPiece();
    }

    /** (컨트롤) 블록을 좌우로 이동합니다. */
    function handleMove(dir) {
        if (!currentPiece) return;
        currentPiece.x += dir;
        if (checkCollision(currentPiece)) {
            currentPiece.x -= dir; // 충돌 시 원위치
        }
    }

    /** (컨트롤) 블록을 회전합니다. (기본 벽 충돌 처리 포함) */
    function handleRotate() {
        if (!currentPiece) return;

        // 1. 매트릭스 회전 (시계 방향)
        const shape = currentPiece.shape;
        const N = shape.length;
        const newShape = Array.from({ length: N }, () => Array(N).fill(0));

        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                newShape[c][N - 1 - r] = shape[r][c];
            }
        }

        // 2. 충돌 테스트 (월 킥)
        const originalShape = currentPiece.shape;
        const originalX = currentPiece.x;
        currentPiece.shape = newShape;

        // [0, 1, -1, 2, -2] 순서로 킥 테스트
        const kicks = [0, 1, -1, 2, -2];
        let canRotate = false;
        for (const kick of kicks) {
            currentPiece.x = originalX + kick;
            if (!checkCollision(currentPiece)) {
                canRotate = true;
                break; // 성공
            }
        }

        // 3. 회전 실패 시 원상 복구
        if (!canRotate) {
            currentPiece.shape = originalShape;
            currentPiece.x = originalX;
        }
    }

    /**
     * 블록이 보드 경계나 다른 블록과 충돌하는지 확인합니다.
     * @param {object} piece - currentPiece
     * @returns {boolean} 충돌하면 true
     */
    function checkCollision(piece) {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (piece.shape[r][c] === 0) continue; // 블록의 빈 부분

                const newX = piece.x + c;
                const newY = piece.y + r;

                // 1. 벽 충돌 (좌, 우, 바닥)
                if (newX < 0 || newX >= COLS || newY >= ROWS) {
                    return true;
                }

                // 2. 다른 블록과 충돌 (천장 위는 괜찮음)
                if (newY >= 0 && board[newY][newX] !== 0) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 블록을 보드에 고정(착지)시킵니다. */
    function lockPiece() {
        currentPiece.shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value !== 0) {
                    const boardX = currentPiece.x + c;
                    const boardY = currentPiece.y + r;
                    // 보드 상단 밖(음수 y)에 고정되지 않도록
                    if (boardY >= 0) {
                        board[boardY][boardX] = value;
                    }
                }
            });
        });

        // 줄 제거 확인
        const stageWasCleared = clearLines(); // [수정] 반환 값 받기

        // [추가] 스테이지가 클리어 되었다면, 새 블록 생성을 막고 즉시 종료
        if (stageWasCleared) {
            return;
        }

        // 새 블록 생성
        spawnNewPiece();

        // UI 업데이트
        updateGameUI();
    }

    /** 완성된 줄을 찾아 제거하고 점수를 계산합니다. */
    function clearLines() {
        let linesRemoved = 0;

        // 보드를 아래에서부터 위로 검사
        for (let r = ROWS - 1; r >= 0; r--) {
            if (board[r].every(cell => cell !== 0)) {
                // 줄이 꽉 찼음
                linesRemoved++;
                board.splice(r, 1); // 해당 줄 제거
                board.unshift(Array(COLS).fill(0)); // 맨 위에 빈 줄 추가
                r++; // 방금 새 줄을 추가했으니, 같은 줄(인덱스)을 다시 검사
            }
        }

        if (linesRemoved > 0) {
            linesClearedThisStage += linesRemoved;

            // 점수 계산 (예: 1줄: 100, 2줄: 300, 3줄: 500, 4줄(테트리스): 800)
            let lineScore = [0, 100, 300, 500, 800];
            score += lineScore[linesRemoved] || lineScore[4]; // 4줄 이상은 800점

            // 스테이지 클리어 확인
            if (linesClearedThisStage >= currentStage.goal.count) {
                handleStageClear();
                return true;
            }
        }
        return false;
    }


    // --- 7. 그리기(Drawing) 함수 ---

    /** 게임 보드와 현재 블록을 모두 그립니다. */
    function drawGame() {
        // 1. 캔버스 초기화 (검은색)
        boardCtx.fillStyle = '#000';
        boardCtx.fillRect(0, 0, boardCanvas.width, boardCanvas.height);

        // 2. 고정된 블록 그리기 (보드)
        drawBoard();

        // 3. 현재 움직이는 블록 그리기
        if (currentPiece) {
            drawPiece(currentPiece, boardCtx, BLOCK_SIZE);
        }
    }

    /** 보드(board 2D 배열)에 고정된 블록들을 그립니다. */
    function drawBoard() {
        board.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value !== 0) {
                    boardCtx.fillStyle = COLORS[value];
                    boardCtx.fillRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                    boardCtx.strokeStyle = '#000'; // 블록 테두리
                    boardCtx.strokeRect(c * BLOCK_SIZE, r * BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
                }
            });
        });
    }

    /** '다음 블록' 캔버스에 다음 블록을 그립니다. */
    function drawNextPiece() {
        const size = BLOCK_SIZE - 5; // 약간 작은 크기
        nextCtx.fillStyle = '#111'; // 배경
        nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);

        if (nextPiece) {
            // 중앙 정렬
            const piece = nextPiece;
            const shape = piece.shape;
            const w = shape[0].length * size;
            const h = shape.length * size;
            const offsetX = (nextCanvas.width - w) / 2;
            const offsetY = (nextCanvas.height - h) / 2;

            drawPiece(nextPiece, nextCtx, size, offsetX, offsetY);
        }
    }

    /**
     * 특정 블록 조각을 지정된 캔버스 컨텍스트에 그립니다.
     * @param {object} piece - 그릴 블록 (shape, color, x, y)
     * @param {CanvasRenderingContext2D} ctx - 그릴 캔버스
     * @param {number} blockSize - 블록 한 칸의 크기
     * @param {number} [offsetX=0] - 캔버스 내 X축 오프셋
     * @param {number} [offsetY=0] - 캔버스 내 Y축 오프셋
     */
    function drawPiece(piece, ctx, blockSize, offsetX = 0, offsetY = 0) {
        ctx.fillStyle = piece.color;
        piece.shape.forEach((row, r) => {
            row.forEach((value, c) => {
                if (value !== 0) {
                    const x = (piece.x + c) * blockSize + offsetX;
                    const y = (piece.y + r) * blockSize + offsetY;

                    // nextCtx에 그릴 땐 piece.x, piece.y가 아닌 오프셋만 사용
                    if (ctx === nextCtx) {
                        ctx.fillRect(c * blockSize + offsetX, r * blockSize + offsetY, blockSize, blockSize);
                        ctx.strokeStyle = '#000';
                        ctx.strokeRect(c * blockSize + offsetX, r * blockSize + offsetY, blockSize, blockSize);
                    } else {
                        // boardCtx에 그릴 땐 piece.x, piece.y 사용
                        ctx.fillRect(x, y, blockSize, blockSize);
                        ctx.strokeStyle = '#000';
                        ctx.strokeRect(x, y, blockSize, blockSize);
                    }
                }
            });
        });
    }


    // --- 8. 입력 처리 (키보드) ---
    function handleKeyPress(e) {
        if (!currentPiece || !gameLoopId) return; // 게임이 실행 중일 때만

        switch (e.key) {
            case 'ArrowLeft':
                e.preventDefault();
                handleMove(-1);
                break;
            case 'ArrowRight':
                e.preventDefault();
                handleMove(1);
                break;
            case 'ArrowDown':
                e.preventDefault();
                handleDrop();
                break;
            case 'ArrowUp': // 위쪽 화살표: 회전
                e.preventDefault();
                handleRotate();
                break;
            case ' ': // 스페이스바: 하드 드롭
                e.preventDefault();
                handleHardDrop();
                break;
        }
        drawGame(); // 키 입력 즉시 화면 갱신
    }

    // --- 게임 시작 ---
    init();
});
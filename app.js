
// ==========================================
// オフライン対応（送信キュー）
// ==========================================
function saveToQueue(payload) {
  let queue = JSON.parse(localStorage.getItem('memoQueue') || '[]');
  queue.push(payload);
  localStorage.setItem('memoQueue', JSON.stringify(queue));
  alert('通信エラーのため一時保存しました。電波が回復した時に自動で送信されます。');
}

async function syncQueue() {
  let queue = JSON.parse(localStorage.getItem('memoQueue') || '[]');
  if (queue.length === 0) return;
  
  let gasUrl = localStorage.getItem('gasUrl');
  if (!gasUrl) return;

  const originalLength = queue.length;
  let remainingQueue = [];

  for (let payload of queue) {
    try {
            if (!navigator.onLine) {
        saveToQueue(payload);
        this.clearMemo();
        this.updateStatus('一時保存完了 (オフライン)', 'ready');
        return;
      }
      let response = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      let result = await response.json();
      if (result.status !== 'success') {
        remainingQueue.push(payload);
      }
    } catch(e) {
      remainingQueue.push(payload);
    }
  }

  localStorage.setItem('memoQueue', JSON.stringify(remainingQueue));
  if(remainingQueue.length < originalLength) {
    alert(`オフライン時に保存されていた${originalLength - remainingQueue.length}件のメモを自動送信しました！`);
  }
}

window.addEventListener('online', syncQueue);

// PWA Service Worker 登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('ServiceWorker registered:', reg))
      .catch(err => console.error('ServiceWorker registration failed:', err));
  });
}

// アプリのメイン状態管理
class VoiceMemoApp {
  constructor() {
    // DOM要素の取得
    this.elements = {
      stepRecording: document.getElementById('step-recording'),
      stepComplete: document.getElementById('step-complete'),
      statusBar: document.getElementById('status-bar'),
      statusIndicator: document.getElementById('status-indicator'),
      statusText: document.getElementById('status-text'),
      recognizedText: document.getElementById('recognized-text'),
      charCount: document.getElementById('char-count'),
      charWarning: document.getElementById('char-warning'),
      pauseResumeBtn: document.getElementById('pause-resume-btn'),
      pauseIcon: document.getElementById('pause-icon'),
      pauseText: document.getElementById('pause-text'),
      manualInputBtn: document.getElementById('manual-input-btn'),
      manualIcon: document.getElementById('manual-icon'),
      manualText: document.getElementById('manual-text'),
      submitBtn: document.getElementById('submit-btn'),
      clearBtn: document.getElementById('clear-btn'),
      continueBtn: document.getElementById('continue-btn'),
      closeBtn: document.getElementById('close-btn'),
      settingsToggleBtn: document.getElementById('settings-toggle-btn'),
      settingsPanel: document.getElementById('settings-panel'),
      gasUrlInput: document.getElementById('gas-url-input'),
      secretKeyInput: document.getElementById('secret-key-input'),
      saveSettingsBtn: document.getElementById('save-settings-btn')
    };

    // 音声認識の設定
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.hasSpeechSupport = !!SpeechRecognition;

    if (this.hasSpeechSupport) {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'ja-JP';
    } else {
      console.warn('Web Speech API 非対応ブラウザです。手入力モードを優先します。');
    }

    // 内部状態 (重複を100%防ぐための構造に改善)
    this.isPaused = false;
    this.isManualMode = false;
    this.isSubmitting = false;

    this.savedTranscript = '';        // 過去セッションや手入力で確定済みのテキスト
    this.sessionFinalTranscript = ''; // 現在の認識セッションで確定したテキスト
    this.interimTranscript = '';      // 現在の認識セッションの未確定テキスト

    // ローカルストレージキー
    this.STORAGE_KEYS = {
      TEXT: 'farm_voice_memo_text',
      IS_PAUSED: 'farm_voice_memo_is_paused',
      IS_MANUAL: 'farm_voice_memo_is_manual',
      GAS_URL: 'farm_voice_memo_gas_url',
      SECRET_KEY: 'farm_voice_memo_secret_key'
    };

    this.init();
  }

  init() {
    this.loadSettings();
    this.restoreState();
    this.bindEvents();

    if (this.isManualMode) {
      this.enableManualMode(true);
    } else if (this.hasSpeechSupport) {
      this.setupRecognition();
      if (!this.isPaused) {
        this.startRecognition();
      } else {
        this.updateStatus('paused', '一時停止中');
      }
    } else {
      this.enableManualMode(true);
    }
  }

  // 設定ロード
  loadSettings() {
    const savedGasUrl = localStorage.getItem(this.STORAGE_KEYS.GAS_URL) || '';
    const savedSecretKey = localStorage.getItem(this.STORAGE_KEYS.SECRET_KEY) || 'secret-1234';

    this.elements.gasUrlInput.value = savedGasUrl;
    this.elements.secretKeyInput.value = savedSecretKey;
  }

  // 設定保存
  saveSettings() {
    const url = this.elements.gasUrlInput.value.trim();
    const key = this.elements.secretKeyInput.value.trim();

    localStorage.setItem(this.STORAGE_KEYS.GAS_URL, url);
    localStorage.setItem(this.STORAGE_KEYS.SECRET_KEY, key);

    alert('設定を保存しました。');
    this.elements.settingsPanel.classList.add('hidden');
  }

  // 状態復元
  restoreState() {
    const savedText = localStorage.getItem(this.STORAGE_KEYS.TEXT);
    if (savedText) {
      this.savedTranscript = savedText;
      this.updateDisplay();
    }

    const savedIsPaused = localStorage.getItem(this.STORAGE_KEYS.IS_PAUSED);
    if (savedIsPaused !== null) {
      this.isPaused = savedIsPaused === 'true';
    }

    const savedIsManual = localStorage.getItem(this.STORAGE_KEYS.IS_MANUAL);
    if (savedIsManual !== null) {
      this.isManualMode = savedIsManual === 'true';
    }
  }

  // 状態保存
  persistState() {
    const fullText = this.getFullText();
    localStorage.setItem(this.STORAGE_KEYS.TEXT, fullText);
    localStorage.setItem(this.STORAGE_KEYS.IS_PAUSED, this.isPaused);
    localStorage.setItem(this.STORAGE_KEYS.IS_MANUAL, this.isManualMode);
  }

  // 現在の全体テキストを取得
  getFullText() {
    if (this.isManualMode) {
      return this.elements.recognizedText.value;
    }
    let parts = [];
    if (this.savedTranscript) parts.push(this.savedTranscript.trim());
    if (this.sessionFinalTranscript) parts.push(this.sessionFinalTranscript.trim());
    if (this.interimTranscript) parts.push(this.interimTranscript.trim());
    return parts.join(' ');
  }

  // イベントバインド
  bindEvents() {
    this.elements.settingsToggleBtn.addEventListener('click', () => {
      this.elements.settingsPanel.classList.toggle('hidden');
    });
    this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    this.elements.pauseResumeBtn.addEventListener('click', () => this.togglePauseResume());
    this.elements.manualInputBtn.addEventListener('click', () => this.toggleManualInputMode());
    this.elements.submitBtn.addEventListener('click', () => this.submitMemo());
    this.elements.clearBtn.addEventListener('click', () => this.clearMemo());

    // 手入力時の入力監視
    this.elements.recognizedText.addEventListener('input', (e) => {
      if (this.isManualMode) {
        this.savedTranscript = e.target.value;
        this.sessionFinalTranscript = '';
        this.interimTranscript = '';
        this.updateCharCounterOnly();
        this.persistState();
      }
    });

    this.elements.continueBtn.addEventListener('click', () => this.resetAndStartNew());
    this.elements.closeBtn.addEventListener('click', () => this.closeApp());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        console.log('画面が再表示されました。状態を確認・再開します。');
        this.restoreState();
        if (!this.isManualMode && !this.isPaused && !this.isSubmitting && this.hasSpeechSupport) {
          this.startRecognition();
        }
      } else {
        this.persistState();
      }
    });
  }

  // 音声認識のイベント（重複ループ排除処理・累積バグ対策）
  setupRecognition() {
    this.recognition.onresult = (event) => {
      if (this.isManualMode || this.isCleared) return;

      let currentSessionFinal = '';
      let currentInterim = '';

      // 毎回インデックス0から走査して現在セッションの文字を完全再構築
      for (let i = 0; i < event.results.length; ++i) {
        let transcript = event.results[i][0].transcript.trim();
        if (!transcript) continue;

        if (event.results[i].isFinal) {
          if (!currentSessionFinal) {
            currentSessionFinal = transcript;
          } else {
            // Android Web Speech API の累積・重複バグ対策
            const cleanCurrent = currentSessionFinal.replace(/\s+/g, '');
            const cleanTranscript = transcript.replace(/\s+/g, '');

            if (cleanTranscript === cleanCurrent) {
              // 完全一致の場合は無視
            } else if (cleanTranscript.startsWith(cleanCurrent)) {
              // 累積テキストとして上書き（前回のテキストを含んでいる場合）
              currentSessionFinal = transcript;
            } else if (cleanCurrent.endsWith(cleanTranscript)) {
              // 末尾の重複送信も無視
            } else {
              // 独立した新しいフレーズとして追加
              currentSessionFinal += ' ' + transcript;
            }
          }
        } else {
          // interim の処理
          if (!currentInterim) {
            currentInterim = transcript;
          } else {
            const cleanInterim = currentInterim.replace(/\s+/g, '');
            const cleanTranscript = transcript.replace(/\s+/g, '');
            if (cleanTranscript === cleanInterim || cleanInterim.endsWith(cleanTranscript)) {
              // 無視
            } else if (cleanTranscript.startsWith(cleanInterim)) {
              currentInterim = transcript;
            } else {
              currentInterim += ' ' + transcript;
            }
          }
        }
      }

      this.sessionFinalTranscript = currentSessionFinal;
      this.interimTranscript = currentInterim;

      this.updateDisplay();
      this.persistState();
    };

    this.recognition.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'no-speech' || event.error === 'network') {
        if (!this.isManualMode && !this.isPaused && !this.isSubmitting) {
          setTimeout(() => this.startRecognition(), 500);
        }
      }
    };

    this.recognition.onend = () => {
      console.log('Speech recognition ended');
      // 認識セッション終了時、確定分を savedTranscript に退避
      if (!this.isManualMode && !this.isCleared) {
        this.consolidateTranscripts();
      }
      
      if (!this.isManualMode && !this.isPaused && !this.isSubmitting) {
        this.startRecognition();
      }
    };
  }

  // 現在のセッションの確定テキストを永続分へ統合
  consolidateTranscripts() {
    if (this.sessionFinalTranscript) {
      this.savedTranscript = (this.savedTranscript ? this.savedTranscript + ' ' : '') + this.sessionFinalTranscript;
      this.sessionFinalTranscript = '';
    }
    this.interimTranscript = '';
  }

  // 音声認識開始
  startRecognition() {
    if (!this.hasSpeechSupport || this.isSubmitting || this.isManualMode) return;
    try {
      this.isCleared = false;
      this.recognition.start();
      this.updateStatus('recording', '録音中...');
    } catch (e) {}
  }

  // 音声認識停止
  stopRecognition() {
    if (!this.hasSpeechSupport) return;
    try {
      this.recognition.stop();
    } catch (e) {}
    // ここで consolidateTranscripts() を呼ぶと、遅延して届いた onresult と競合して重複復活するバグを防ぐため削除
  }

  // 表示の全更新
  updateDisplay() {
    const fullText = this.getFullText();
    this.elements.recognizedText.value = fullText;
    this.updateCharCounterOnly();
  }

  // 文字数カウント更新
  updateCharCounterOnly() {
    const count = this.elements.recognizedText.value.trim().length;
    this.elements.charCount.innerText = count;

    if (count <= 10) {
      this.elements.charWarning.classList.remove('hidden');
    } else {
      this.elements.charWarning.classList.add('hidden');
    }
  }

  // ステータス表示更新
  updateStatus(state, text) {
    this.elements.statusIndicator.className = 'status-indicator ' + state;
    this.elements.statusText.innerText = text;
  }

  // 一時停止 / 再開
  togglePauseResume() {
    if (this.isManualMode) {
      this.enableManualMode(false);
      this.isPaused = false;
      this.startRecognition();
      return;
    }

    if (this.isPaused) {
      this.isPaused = false;
      this.elements.pauseIcon.innerText = '⏸️';
      this.elements.pauseText.innerText = '一時停止';
      this.startRecognition();
      this.updateStatus('recording', '録音中...');
    } else {
      this.isPaused = true;
      this.stopRecognition();
      this.elements.pauseIcon.innerText = '▶️';
      this.elements.pauseText.innerText = '再開';
      this.updateStatus('paused', '一時停止中');
    }
    this.persistState();
  }

  // 手入力モードの切替
  toggleManualInputMode() {
    this.enableManualMode(!this.isManualMode);
  }

  // 手入力モード有効化
  enableManualMode(enable) {
    this.isManualMode = enable;
    if (enable) {
      this.isCleared = true;
      this.stopRecognition();
      this.elements.recognizedText.removeAttribute('readonly');
      this.elements.manualIcon.innerText = '🎙️';
      this.elements.manualText.innerText = '音声に戻る';
      this.updateStatus('manual', '手入力中');
      this.elements.recognizedText.focus();
    } else {
      this.consolidateTranscripts();
      this.savedTranscript = this.elements.recognizedText.value;
      this.elements.recognizedText.setAttribute('readonly', 'readonly');
      this.elements.manualIcon.innerText = '⌨️';
      this.elements.manualText.innerText = '手入力する';
      if (this.isPaused) {
        this.updateStatus('paused', '一時停止中');
      } else {
        this.startRecognition();
      }
    }
    this.persistState();
  }

  // メモ消去
  clearMemo() {
    if (confirm('入力内容を消去してやり直しますか？')) {
      this.isCleared = true;
      this.savedTranscript = '';
      this.sessionFinalTranscript = '';
      this.interimTranscript = '';
      this.updateDisplay();
      localStorage.removeItem(this.STORAGE_KEYS.TEXT);

      if (this.isManualMode) {
        this.elements.recognizedText.focus();
      } else if (this.isPaused) {
        this.togglePauseResume();
      } else {
        this.stopRecognition();
      }
    }
  }

  // 送信
  async submitMemo() {
    const textToSend = this.getFullText().trim();

    if (textToSend.length <= 10) {
      alert('入力テキストが短すぎます。10文字以上入力またはお喋りしてから送信してください。');
      return;
    }

    const gasUrl = localStorage.getItem(this.STORAGE_KEYS.GAS_URL);
    const secretKey = localStorage.getItem(this.STORAGE_KEYS.SECRET_KEY);

    if (!gasUrl) {
      alert('GAS Web App URLが設定されていません。右上の⚙️設定ボタンからURLを入力してください。');
      this.elements.settingsPanel.classList.remove('hidden');
      return;
    }

    this.isSubmitting = true;
    this.stopRecognition();
    this.updateStatus('submitting', '送信中...');
    this.elements.submitBtn.disabled = true;
    this.elements.pauseResumeBtn.disabled = true;
    this.elements.manualInputBtn.disabled = true;
    this.elements.clearBtn.disabled = true;

    try {
      const payload = {
        secret_key: secretKey,
        memo_text: textToSend
      };

      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (result.status === 'success') {
        this.isCleared = true;
        this.savedTranscript = '';
        this.sessionFinalTranscript = '';
        this.interimTranscript = '';
        localStorage.removeItem(this.STORAGE_KEYS.TEXT);
        this.showStepComplete();
      } else {
        throw new Error(result.message || '送信に失敗しました。');
      }

    } catch (err) {
      alert('エラーが発生しました: ' + err.message);
      if (this.isManualMode) {
        this.updateStatus('manual', '手入力中');
      } else {
        this.updateStatus(this.isPaused ? 'paused' : 'recording', this.isPaused ? '一時停止中' : '録音中...');
      }
    } finally {
      this.isSubmitting = false;
      this.elements.submitBtn.disabled = false;
      this.elements.pauseResumeBtn.disabled = false;
      this.elements.manualInputBtn.disabled = false;
      this.elements.clearBtn.disabled = false;
    }
  }

  showStepComplete() {
    this.elements.stepRecording.classList.add('hidden');
    this.elements.stepComplete.classList.remove('hidden');
  }

  resetAndStartNew() {
    this.elements.stepComplete.classList.add('hidden');
    this.elements.stepRecording.classList.remove('hidden');
    this.savedTranscript = '';
    this.sessionFinalTranscript = '';
    this.interimTranscript = '';
    this.updateDisplay();

    this.enableManualMode(false);
    this.isPaused = false;
    this.elements.pauseIcon.innerText = '⏸️';
    this.elements.pauseText.innerText = '一時停止';
    this.startRecognition();
  }

  closeApp() {
    this.stopRecognition();
    this.persistState();
    window.close();
    setTimeout(() => {
      alert('アプリを終了します。画面を閉じてください。');
    }, 300);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new VoiceMemoApp();
});

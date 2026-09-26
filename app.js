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

    // 内部状態
    this.isPaused = false;
    this.isManualMode = false;
    this.isSubmitting = false;
    this.finalTranscript = '';
    this.interimTranscript = '';

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
      // デフォルト: アプリ起動時に即座に録音開始
      if (!this.isPaused) {
        this.startRecognition();
      } else {
        this.updateStatus('paused', '一時停止中');
      }
    } else {
      // 音声非対応端末は自動で手入力モードへ
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
      this.finalTranscript = savedText;
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
    localStorage.setItem(this.STORAGE_KEYS.TEXT, this.finalTranscript);
    localStorage.setItem(this.STORAGE_KEYS.IS_PAUSED, this.isPaused);
    localStorage.setItem(this.STORAGE_KEYS.IS_MANUAL, this.isManualMode);
  }

  // イベントバインド
  bindEvents() {
    // 設定ボタン
    this.elements.settingsToggleBtn.addEventListener('click', () => {
      this.elements.settingsPanel.classList.toggle('hidden');
    });
    this.elements.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    // 操作ボタン
    this.elements.pauseResumeBtn.addEventListener('click', () => this.togglePauseResume());
    this.elements.manualInputBtn.addEventListener('click', () => this.toggleManualInputMode());
    this.elements.submitBtn.addEventListener('click', () => this.submitMemo());
    this.elements.clearBtn.addEventListener('click', () => this.clearMemo());

    // テキストエリアの手入力監視
    this.elements.recognizedText.addEventListener('input', (e) => {
      if (this.isManualMode) {
        this.finalTranscript = e.target.value;
        this.interimTranscript = '';
        this.updateCharCounterOnly();
        this.persistState();
      }
    });

    // Step 2 ボタン
    this.elements.continueBtn.addEventListener('click', () => this.resetAndStartNew());
    this.elements.closeBtn.addEventListener('click', () => this.closeApp());

    // 画面オフ・スリープ対策: visibilitychange
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

  // 音声認識イベント設定
  setupRecognition() {
    this.recognition.onresult = (event) => {
      if (this.isManualMode) return;
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          this.finalTranscript += event.results[i][0].transcript;
        } else {
          currentInterim += event.results[i][0].transcript;
        }
      }
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
      if (!this.isManualMode && !this.isPaused && !this.isSubmitting) {
        this.startRecognition();
      }
    };
  }

  // 音声認識開始
  startRecognition() {
    if (!this.hasSpeechSupport || this.isSubmitting || this.isManualMode) return;
    try {
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
  }

  // 表示の全更新
  updateDisplay() {
    const fullText = this.finalTranscript + (this.interimTranscript ? ' ' + this.interimTranscript : '');
    this.elements.recognizedText.value = fullText;
    this.updateCharCounterOnly();
  }

  // 文字数カウントのみ更新
  updateCharCounterOnly() {
    const count = this.elements.recognizedText.value.trim().length;
    this.elements.charCount.innerText = count;

    if (count <= 10) {
      this.elements.charWarning.classList.remove('hidden');
    } else {
      this.elements.charWarning.classList.add('hidden');
    }
  }

  // ステータス更新
  updateStatus(state, text) {
    this.elements.statusIndicator.className = 'status-indicator ' + state;
    this.elements.statusText.innerText = text;
  }

  // 一時停止 / 再開 切替
  togglePauseResume() {
    if (this.isManualMode) {
      // 手入力モードから一時停止ボタンを押した場合は音声認識モードに復帰
      this.enableManualMode(false);
      this.isPaused = false;
      this.startRecognition();
      return;
    }

    if (this.isPaused) {
      // 再開
      this.isPaused = false;
      this.elements.pauseIcon.innerText = '⏸️';
      this.elements.pauseText.innerText = '一時停止';
      this.startRecognition();
      this.updateStatus('recording', '録音中...');
    } else {
      // 一時停止
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

  // 手入力モードの有効化/解除
  enableManualMode(enable) {
    this.isManualMode = enable;
    if (enable) {
      this.stopRecognition();
      this.elements.recognizedText.removeAttribute('readonly');
      this.elements.manualIcon.innerText = '🎙️';
      this.elements.manualText.innerText = '音声に戻る';
      this.updateStatus('manual', '手入力中');
      this.elements.recognizedText.focus();
    } else {
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

  // やり直し (クリア)
  clearMemo() {
    if (confirm('入力内容を消去してやり直しますか？')) {
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.updateDisplay();
      localStorage.removeItem(this.STORAGE_KEYS.TEXT);

      if (this.isManualMode) {
        this.elements.recognizedText.focus();
      } else if (this.isPaused) {
        this.togglePauseResume();
      } else {
        this.startRecognition();
      }
    }
  }

  // メモ送信
  async submitMemo() {
    const textToSend = this.elements.recognizedText.value.trim();

    // エラー検知（空送信・ノイズ防止：10文字以下）
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

    // 送信処理開始
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
        this.finalTranscript = '';
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

  // 送信完了画面 (Step 2) の表示
  showStepComplete() {
    this.elements.stepRecording.classList.add('hidden');
    this.elements.stepComplete.classList.remove('hidden');
  }

  // 続けて入力する (Step 1へ戻る)
  resetAndStartNew() {
    this.elements.stepComplete.classList.add('hidden');
    this.elements.stepRecording.classList.remove('hidden');
    this.finalTranscript = '';
    this.interimTranscript = '';
    this.updateDisplay();

    // デフォルト（音声認識モード）に戻す
    this.enableManualMode(false);
    this.isPaused = false;
    this.elements.pauseIcon.innerText = '⏸️';
    this.elements.pauseText.innerText = '一時停止';
    this.startRecognition();
  }

  // 終了する
  closeApp() {
    this.stopRecognition();
    this.persistState();
    window.close();
    setTimeout(() => {
      alert('アプリを終了します。画面を閉じてください。');
    }, 300);
  }
}

// アプリ起動
window.addEventListener('DOMContentLoaded', () => {
  window.app = new VoiceMemoApp();
});

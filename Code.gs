/**
 * 農作業音声メモ PWA - バックエンド Google Apps Script (GAS)
 */

// ==============================================================================
// 1. 設定項目（お使いの環境に合わせて変更してください）
// ==============================================================================
const CONFIG = {
  SECRET_KEY: "secret-1234",                      // フロントエンドと共有するシークレットキー
  GEMINI_API_KEY: "YOUR_GEMINI_API_KEY",          // Google AI Studioで取得したGemini APIキー
  SPREADSHEET_ID: "YOUR_SPREADSHEET_ID",          // 保存先GoogleスプレッドシートのID
  SHEET_NAME: "メイン",                           // 保存先のシート名
  GEMINI_MODEL: "gemini-1.5-flash"                // Geminiモデル名
};

// ==============================================================================
// 2. メイン処理 (doPost)
// ==============================================================================
function doPost(e) {
  try {
    // リクエストボディのパース
    if (!e || !e.postData || !e.postData.contents) {
      return createJsonResponse({ status: "error", message: "リクエストデータが空です。" });
    }

    let requestData;
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return createJsonResponse({ status: "error", message: "無効なJSONフォーマットです。" });
    }

    const { secret_key, memo_text } = requestData;

    // 1. シークレットキー検証
    if (secret_key !== CONFIG.SECRET_KEY) {
      return createJsonResponse({ status: "error", message: "認証失敗: シークレットキーが一致しません。" });
    }

    if (!memo_text || memo_text.trim() === "") {
      return createJsonResponse({ status: "error", message: "テキストデータが空です。" });
    }

    // 2. Gemini API 呼び出し（単一呼び出し、ループ/リトライなし）
    const geminiResult = callGeminiApi(memo_text);

    // 3. スプレッドシートへの保存
    saveToSpreadsheet(geminiResult);

    // 成功レスポンスを返して即座にプロセス終了
    return createJsonResponse({
      status: "success",
      data: geminiResult
    });

  } catch (error) {
    // 無限リトライはせず、エラーが発生したら即時にエラー内容を返してプロセス終了
    Logger.log("Error in doPost: " + error.toString());
    return createJsonResponse({
      status: "error",
      message: error.toString()
    });
  }
}

// GETリクエストに対する動作確認用
function doGet() {
  return createJsonResponse({ status: "ok", message: "GAS Web App is running." });
}

// ==============================================================================
// 3. Gemini API 連携関数
// ==============================================================================
function callGeminiApi(memoText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const promptText = `
以下の農作業の音声メモから、1.内容を表すカテゴリータグ（1つ）、2.意味を変えずに誤字脱字を直し、熱量（感情や実損額など）をそのまま残した清書版テキスト、3.短くまとめた要約版テキストを作成し、JSON形式で返して。

音声メモ：
${memoText}

【出力条件】
必ず以下の属性を持つJSONオブジェクトのみを出力してください（Markdownの装飾コードブロック \`\`\`json 等は含めても含めなくても構いませんが、JSONデータのみが含まれるようにしてください）。

{
  "category": "カテゴリータグ（例：害虫対策、設備トラブル、収穫記録、気象変化など1つの短い単語）",
  "polished_text": "熱量をそのまま残した清書版テキスト",
  "summary": "短くまとめた要約版テキスト"
}
`.trim();

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  // 1回のみ通信を実行（リトライやループ処理は厳格に排除）
  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini API エラー (Status ${responseCode}): ${responseText}`);
  }

  const jsonResponse = JSON.parse(responseText);
  if (!jsonResponse.candidates || jsonResponse.candidates.length === 0) {
    throw new Error("Gemini API から応答が得られませんでした。");
  }

  const contentText = jsonResponse.candidates[0].content.parts[0].text;
  
  // JSONパース処理
  try {
    // もし ```json ... ``` が含まれている場合の除去処理
    const cleanJsonText = contentText.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsedData = JSON.parse(cleanJsonText);
    return {
      category: parsedData.category || "その他",
      polished_text: parsedData.polished_text || memoText,
      summary: parsedData.summary || memoText
    };
  } catch (e) {
    Logger.log("JSON Parse Warning: " + e.toString() + " Output text: " + contentText);
    return {
      category: "その他",
      polished_text: memoText,
      summary: memoText
    };
  }
}

// ==============================================================================
// 4. スプレッドシート書き込み関数
// ==============================================================================
function saveToSpreadsheet(data) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  
  // 指定されたシートが存在しない場合は自動作成
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
    // ヘッダー行の追加
    sheet.appendRow(["タイムスタンプ", "カテゴリータグ", "要約版テキスト", "清書版テキスト（全文）"]);
  }

  // A列: タイムスタンプ (yyyy/MM/dd HH:mm形式)
  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
  
  // マッピングにしたがって列追加
  // A列: タイムスタンプ
  // B列: 自動生成された「カテゴリータグ」
  // C列: 自動生成された「要約版テキスト」
  // D列: 熱量を残した「清書版テキスト（全文）」
  sheet.appendRow([
    timestamp,
    data.category,
    data.summary,
    data.polished_text
  ]);
}

// ==============================================================================
// 5. レスポンス作成ヘルパー関数
// ==============================================================================
function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

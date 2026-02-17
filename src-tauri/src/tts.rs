use crate::state::AppState;
use base64::Engine;
use comrak::nodes::NodeValue;
use comrak::{parse_document, Arena, Options};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Emitter, State};

// ===== Key Management =====

const TTS_OPENAI_KEY_FILE: &str = "tts_openai_key";
const TTS_GOOGLE_KEY_FILE: &str = "tts_google_key";
const TTS_ELEVENLABS_KEY_FILE: &str = "tts_elevenlabs_key";

fn load_key_file(app_data_dir: &Path, filename: &str) -> Option<String> {
    let path = app_data_dir.join(filename);
    if path.exists() {
        if let Ok(key) = fs::read_to_string(&path) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                return Some(key);
            }
        }
    }
    None
}

fn save_key_file(app_data_dir: &Path, filename: &str, key: &str) {
    let _ = fs::create_dir_all(app_data_dir);
    let _ = fs::write(app_data_dir.join(filename), key);
}

fn remove_key_file(app_data_dir: &Path, filename: &str) {
    let _ = fs::remove_file(app_data_dir.join(filename));
}

/// Load saved TTS keys from disk into state (called on app startup).
pub fn load_saved_tts_keys(state: &AppState) {
    let data_dir = state.app_data_dir.lock().unwrap();
    if let Some(ref dir) = *data_dir {
        if let Some(key) = load_key_file(dir, TTS_OPENAI_KEY_FILE) {
            *state.tts_openai_key.lock().unwrap() = Some(key);
        }
        if let Some(key) = load_key_file(dir, TTS_GOOGLE_KEY_FILE) {
            *state.tts_google_key.lock().unwrap() = Some(key);
        }
        if let Some(key) = load_key_file(dir, TTS_ELEVENLABS_KEY_FILE) {
            *state.tts_elevenlabs_key.lock().unwrap() = Some(key);
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsKeyStatus {
    pub openai: bool,
    pub google: bool,
    pub elevenlabs: bool,
}

#[tauri::command]
pub async fn tts_key_status(state: State<'_, AppState>) -> Result<TtsKeyStatus, String> {
    Ok(TtsKeyStatus {
        openai: state.tts_openai_key.lock().unwrap().is_some(),
        google: state.tts_google_key.lock().unwrap().is_some(),
        elevenlabs: state.tts_elevenlabs_key.lock().unwrap().is_some(),
    })
}

#[tauri::command]
pub async fn tts_save_key(
    provider: String,
    key: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let key = key.trim().to_string();
    if key.is_empty() {
        return Err("API key cannot be empty.".into());
    }

    let data_dir = state.app_data_dir.lock().unwrap().clone();
    let dir = data_dir.as_ref().ok_or("App data dir not set")?;

    match provider.as_str() {
        "openai" => {
            save_key_file(dir, TTS_OPENAI_KEY_FILE, &key);
            *state.tts_openai_key.lock().unwrap() = Some(key);
        }
        "google" => {
            save_key_file(dir, TTS_GOOGLE_KEY_FILE, &key);
            *state.tts_google_key.lock().unwrap() = Some(key);
        }
        "elevenlabs" => {
            save_key_file(dir, TTS_ELEVENLABS_KEY_FILE, &key);
            *state.tts_elevenlabs_key.lock().unwrap() = Some(key);
        }
        _ => return Err(format!("Unknown provider: {}", provider)),
    }
    Ok(())
}

#[tauri::command]
pub async fn tts_remove_key(
    provider: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let data_dir = state.app_data_dir.lock().unwrap().clone();
    let dir = data_dir.as_ref().ok_or("App data dir not set")?;

    match provider.as_str() {
        "openai" => {
            remove_key_file(dir, TTS_OPENAI_KEY_FILE);
            *state.tts_openai_key.lock().unwrap() = None;
        }
        "google" => {
            remove_key_file(dir, TTS_GOOGLE_KEY_FILE);
            *state.tts_google_key.lock().unwrap() = None;
        }
        "elevenlabs" => {
            remove_key_file(dir, TTS_ELEVENLABS_KEY_FILE);
            *state.tts_elevenlabs_key.lock().unwrap() = None;
        }
        _ => return Err(format!("Unknown provider: {}", provider)),
    }
    Ok(())
}

// ===== Markdown to Speech Text =====

fn markdown_to_speech_text(markdown: &str, read_code_blocks: bool) -> String {
    let arena = Arena::new();
    let mut options = Options::default();
    options.extension.strikethrough = true;
    options.extension.table = true;
    options.extension.autolink = true;
    options.extension.tasklist = true;
    options.extension.footnotes = true;
    options.extension.shortcodes = true;
    options.parse.smart = true;

    let root = parse_document(&arena, markdown, &options);
    let mut output = String::new();
    collect_speech_text(root, &mut output, read_code_blocks);
    // Clean up excessive newlines
    let mut result = String::new();
    let mut prev_newline_count = 0;
    for ch in output.chars() {
        if ch == '\n' {
            prev_newline_count += 1;
            if prev_newline_count <= 2 {
                result.push(ch);
            }
        } else {
            prev_newline_count = 0;
            result.push(ch);
        }
    }
    result.trim().to_string()
}

fn collect_speech_text<'a>(
    node: &'a comrak::nodes::AstNode<'a>,
    output: &mut String,
    read_code_blocks: bool,
) {
    match &node.data.borrow().value {
        NodeValue::Document => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::Heading(_) => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
            output.push_str("\n\n");
        }
        NodeValue::Paragraph => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
            output.push_str("\n\n");
        }
        NodeValue::Text(text) => {
            output.push_str(text);
        }
        NodeValue::SoftBreak => {
            output.push(' ');
        }
        NodeValue::LineBreak => {
            output.push('\n');
        }
        NodeValue::Code(code) => {
            output.push_str(&code.literal);
        }
        NodeValue::CodeBlock(cb) => {
            if read_code_blocks {
                output.push_str(&cb.literal);
            } else {
                output.push_str("Code block.");
            }
            output.push_str("\n\n");
        }
        NodeValue::BlockQuote => {
            output.push_str("Quote: ");
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::List(_) => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
            output.push('\n');
        }
        NodeValue::Item(_) => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::Link(link) => {
            // Use link text, skip URL
            let has_children = node.children().next().is_some();
            if has_children {
                for child in node.children() {
                    collect_speech_text(child, output, read_code_blocks);
                }
            } else {
                output.push_str(&link.url);
            }
        }
        NodeValue::Image(img) => {
            if !img.title.is_empty() {
                output.push_str(&img.title);
            } else {
                output.push_str("Image");
            }
        }
        NodeValue::Emph => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::Strong => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::Strikethrough => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::ThematicBreak => {
            output.push_str("\n\n");
        }
        NodeValue::Table(_) | NodeValue::TableRow(_) | NodeValue::TableCell => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
            output.push(' ');
        }
        NodeValue::HtmlBlock(block) => {
            // Strip HTML
            let _ = block;
        }
        NodeValue::HtmlInline(html) => {
            let _ = html;
        }
        NodeValue::FootnoteDefinition(_) => {
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
        NodeValue::FootnoteReference(r) => {
            output.push_str(&format!("footnote {}", r.name));
        }
        _ => {
            // For any other node types, recurse into children
            for child in node.children() {
                collect_speech_text(child, output, read_code_blocks);
            }
        }
    }
}

// ===== Chunking =====

const MAX_CHUNK_SIZE: usize = 3500;

fn chunk_speech_text(text: &str) -> Vec<String> {
    let paragraphs: Vec<&str> = text.split("\n\n").collect();
    let mut chunks: Vec<String> = Vec::new();
    let mut current_chunk = String::new();

    for para in paragraphs {
        let para = para.trim();
        if para.is_empty() {
            continue;
        }

        if current_chunk.len() + para.len() + 2 <= MAX_CHUNK_SIZE {
            if !current_chunk.is_empty() {
                current_chunk.push_str("\n\n");
            }
            current_chunk.push_str(para);
        } else if para.len() > MAX_CHUNK_SIZE {
            // Flush current chunk first
            if !current_chunk.is_empty() {
                chunks.push(current_chunk.clone());
                current_chunk.clear();
            }
            // Split long paragraph at sentence boundaries
            let sentences = split_at_sentences(para);
            for sentence in sentences {
                if current_chunk.len() + sentence.len() + 1 <= MAX_CHUNK_SIZE {
                    if !current_chunk.is_empty() {
                        current_chunk.push(' ');
                    }
                    current_chunk.push_str(&sentence);
                } else {
                    if !current_chunk.is_empty() {
                        chunks.push(current_chunk.clone());
                        current_chunk.clear();
                    }
                    // If a single sentence is still too long, just push it
                    if sentence.len() > MAX_CHUNK_SIZE {
                        chunks.push(sentence);
                    } else {
                        current_chunk.push_str(&sentence);
                    }
                }
            }
        } else {
            // Current paragraph doesn't fit — flush and start new chunk
            if !current_chunk.is_empty() {
                chunks.push(current_chunk.clone());
                current_chunk.clear();
            }
            current_chunk.push_str(para);
        }
    }

    if !current_chunk.is_empty() {
        chunks.push(current_chunk);
    }

    chunks
}

fn split_at_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        current.push(chars[i]);
        // Check for sentence boundary: ". " or "! " or "? "
        if (chars[i] == '.' || chars[i] == '!' || chars[i] == '?')
            && i + 1 < len
            && chars[i + 1] == ' '
        {
            sentences.push(current.trim().to_string());
            current.clear();
            i += 1; // skip the space
        }
        i += 1;
    }

    if !current.trim().is_empty() {
        sentences.push(current.trim().to_string());
    }

    sentences
}

// ===== Provider API Calls =====

async fn call_openai_tts(
    client: &reqwest::Client,
    key: &str,
    text: &str,
    voice: &str,
    model: &str,
    speed: f64,
) -> Result<Vec<u8>, String> {
    let body = serde_json::json!({
        "model": model,
        "input": text,
        "voice": voice,
        "speed": speed,
        "response_format": "mp3"
    });

    let resp = client
        .post("https://api.openai.com/v1/audio/speech")
        .header("Authorization", format!("Bearer {}", key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI TTS request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI TTS error ({}): {}", status, body_text));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read OpenAI TTS response: {}", e))
}

#[derive(Deserialize)]
struct GoogleTtsResponse {
    #[serde(rename = "audioContent")]
    audio_content: String,
}

async fn call_google_tts(
    client: &reqwest::Client,
    key: &str,
    text: &str,
    voice_name: &str,
    language_code: &str,
) -> Result<Vec<u8>, String> {
    let body = serde_json::json!({
        "input": { "text": text },
        "voice": {
            "languageCode": language_code,
            "name": voice_name
        },
        "audioConfig": {
            "audioEncoding": "MP3"
        }
    });

    let url = format!(
        "https://texttospeech.googleapis.com/v1/text:synthesize?key={}",
        key
    );

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Google TTS request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("Google TTS error ({}): {}", status, body_text));
    }

    let google_resp: GoogleTtsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Google TTS response: {}", e))?;

    base64::engine::general_purpose::STANDARD
        .decode(&google_resp.audio_content)
        .map_err(|e| format!("Failed to decode Google TTS audio: {}", e))
}

async fn call_elevenlabs_tts(
    client: &reqwest::Client,
    key: &str,
    text: &str,
    voice_id: &str,
) -> Result<Vec<u8>, String> {
    let body = serde_json::json!({
        "text": text,
        "model_id": "eleven_multilingual_v2"
    });

    let url = format!(
        "https://api.elevenlabs.io/v1/text-to-speech/{}",
        voice_id
    );

    let resp = client
        .post(&url)
        .header("xi-api-key", key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ElevenLabs TTS request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        return Err(format!("ElevenLabs TTS error ({}): {}", status, body_text));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| format!("Failed to read ElevenLabs TTS response: {}", e))
}

// ===== TTS Generate Command =====

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsConfig {
    pub provider: String,
    pub voice: String,
    pub speed: Option<f64>,
    pub read_code_blocks: Option<bool>,
    // Google-specific
    pub language_code: Option<String>,
    // OpenAI-specific
    pub model: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsChunkResult {
    pub chunk_index: usize,
    pub total_chunks: usize,
    pub audio_base64: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsGenerateResult {
    pub chunk_index: usize,
    pub total_chunks: usize,
    pub audio_base64: String,
}

#[tauri::command]
pub async fn tts_generate(
    markdown: String,
    config: TtsConfig,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<TtsGenerateResult, String> {
    // Reset cancel flag
    *state.tts_cancel_flag.lock().unwrap() = false;

    let read_code_blocks = config.read_code_blocks.unwrap_or(false);
    let speech_text = markdown_to_speech_text(&markdown, read_code_blocks);

    if speech_text.is_empty() {
        return Err("No text to speak.".into());
    }

    let chunks = chunk_speech_text(&speech_text);
    let total_chunks = chunks.len();

    if total_chunks == 0 {
        return Err("No text to speak.".into());
    }

    // Get the API key for the provider
    let api_key = match config.provider.as_str() {
        "openai" => state
            .tts_openai_key
            .lock()
            .unwrap()
            .clone()
            .ok_or("OpenAI API key not set. Add it in Settings.")?,
        "google" => state
            .tts_google_key
            .lock()
            .unwrap()
            .clone()
            .ok_or("Google Cloud API key not set. Add it in Settings.")?,
        "elevenlabs" => state
            .tts_elevenlabs_key
            .lock()
            .unwrap()
            .clone()
            .ok_or("ElevenLabs API key not set. Add it in Settings.")?,
        _ => return Err(format!("Unknown TTS provider: {}", config.provider)),
    };

    let client = reqwest::Client::new();

    // Generate the first chunk synchronously
    let first_audio = generate_chunk(
        &client,
        &config.provider,
        &api_key,
        &chunks[0],
        &config,
    )
    .await?;

    let first_b64 =
        base64::engine::general_purpose::STANDARD.encode(&first_audio);

    // Spawn background task for remaining chunks
    if total_chunks > 1 {
        let remaining_chunks: Vec<String> = chunks[1..].to_vec();
        let provider = config.provider.clone();
        let voice = config.voice.clone();
        let speed = config.speed;
        let language_code = config.language_code.clone();
        let model = config.model.clone();
        let cancel_flag = state.tts_cancel_flag.clone();

        tauri::async_runtime::spawn(async move {
            let client = reqwest::Client::new();
            for (i, chunk_text) in remaining_chunks.iter().enumerate() {
                // Check cancel flag
                if *cancel_flag.lock().unwrap() {
                    break;
                }

                let cfg = TtsConfig {
                    provider: provider.clone(),
                    voice: voice.clone(),
                    speed,
                    read_code_blocks: None,
                    language_code: language_code.clone(),
                    model: model.clone(),
                };

                match generate_chunk(&client, &provider, &api_key, chunk_text, &cfg).await {
                    Ok(audio) => {
                        let b64 = base64::engine::general_purpose::STANDARD.encode(&audio);
                        let result = TtsChunkResult {
                            chunk_index: i + 1,
                            total_chunks,
                            audio_base64: b64,
                        };
                        let _ = app_handle.emit("tts-chunk-ready", result);
                    }
                    Err(e) => {
                        let _ = app_handle.emit("tts-generation-error", e);
                        break;
                    }
                }
            }
        });
    }

    Ok(TtsGenerateResult {
        chunk_index: 0,
        total_chunks,
        audio_base64: first_b64,
    })
}

async fn generate_chunk(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    text: &str,
    config: &TtsConfig,
) -> Result<Vec<u8>, String> {
    match provider {
        "openai" => {
            let model = config.model.as_deref().unwrap_or("tts-1");
            let speed = config.speed.unwrap_or(1.0);
            call_openai_tts(client, api_key, text, &config.voice, model, speed).await
        }
        "google" => {
            let lang = config.language_code.as_deref().unwrap_or("en-US");
            call_google_tts(client, api_key, text, &config.voice, lang).await
        }
        "elevenlabs" => {
            call_elevenlabs_tts(client, api_key, text, &config.voice).await
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

#[tauri::command]
pub async fn tts_cancel(state: State<'_, AppState>) -> Result<(), String> {
    *state.tts_cancel_flag.lock().unwrap() = true;
    Ok(())
}

// ===== List Voices =====

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
struct ElevenLabsVoicesResponse {
    voices: Vec<ElevenLabsVoice>,
}

#[derive(Deserialize)]
struct ElevenLabsVoice {
    voice_id: String,
    name: String,
}

#[derive(Deserialize)]
struct GoogleVoicesResponse {
    voices: Option<Vec<GoogleVoice>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleVoice {
    name: String,
    language_codes: Vec<String>,
}

#[tauri::command]
pub async fn tts_list_voices(
    provider: String,
    state: State<'_, AppState>,
) -> Result<Vec<TtsVoice>, String> {
    match provider.as_str() {
        "openai" => Ok(vec![
            TtsVoice { id: "alloy".into(), name: "Alloy".into() },
            TtsVoice { id: "ash".into(), name: "Ash".into() },
            TtsVoice { id: "coral".into(), name: "Coral".into() },
            TtsVoice { id: "echo".into(), name: "Echo".into() },
            TtsVoice { id: "fable".into(), name: "Fable".into() },
            TtsVoice { id: "onyx".into(), name: "Onyx".into() },
            TtsVoice { id: "nova".into(), name: "Nova".into() },
            TtsVoice { id: "sage".into(), name: "Sage".into() },
            TtsVoice { id: "shimmer".into(), name: "Shimmer".into() },
        ]),
        "google" => {
            let key = state
                .tts_google_key
                .lock()
                .unwrap()
                .clone()
                .ok_or("Google API key not set.")?;

            let client = reqwest::Client::new();
            let url = format!(
                "https://texttospeech.googleapis.com/v1/voices?key={}&languageCode=en",
                key
            );
            let resp = client
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("Failed to list Google voices: {}", e))?;

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("Google voices API error: {}", body));
            }

            let data: GoogleVoicesResponse = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse Google voices: {}", e))?;

            Ok(data
                .voices
                .unwrap_or_default()
                .into_iter()
                .filter(|v| v.language_codes.iter().any(|c| c.starts_with("en")))
                .map(|v| TtsVoice {
                    id: v.name.clone(),
                    name: v.name,
                })
                .collect())
        }
        "elevenlabs" => {
            let key = state
                .tts_elevenlabs_key
                .lock()
                .unwrap()
                .clone()
                .ok_or("ElevenLabs API key not set.")?;

            let client = reqwest::Client::new();
            let resp = client
                .get("https://api.elevenlabs.io/v1/voices")
                .header("xi-api-key", &key)
                .send()
                .await
                .map_err(|e| format!("Failed to list ElevenLabs voices: {}", e))?;

            if !resp.status().is_success() {
                let body = resp.text().await.unwrap_or_default();
                return Err(format!("ElevenLabs voices API error: {}", body));
            }

            let data: ElevenLabsVoicesResponse = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse ElevenLabs voices: {}", e))?;

            Ok(data
                .voices
                .into_iter()
                .map(|v| TtsVoice {
                    id: v.voice_id,
                    name: v.name,
                })
                .collect())
        }
        _ => Err(format!("Unknown provider: {}", provider)),
    }
}

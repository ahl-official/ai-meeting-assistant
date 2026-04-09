import os
import shutil
import json
import time
import subprocess
import glob
import tempfile
from datetime import datetime, timezone
import requests

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import imageio_ffmpeg
import assemblyai as aai

# Load environment variables
load_dotenv()

# AI Service Clients
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
APPS_SCRIPT_URL = os.getenv("APPS_SCRIPT_URL")

# Initialize the FastAPI application
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for internal company deployment
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Use system temp directory for high-speed, restricted-access cloud stability
TEMP_AUDIO_DIR = os.path.join(tempfile.gettempdir(), "ai_meeting_assistant")

if not os.path.exists(TEMP_AUDIO_DIR):
    os.makedirs(TEMP_AUDIO_DIR)


@app.get("/")
def read_root():
    return {"status": "AI Meeting Assistant API is active"}


def update_meeting_in_sheets(meeting_id: str, updates: dict):
    """Helper to send updates to Google Sheets via Apps Script"""
    if not APPS_SCRIPT_URL:
        print("Warning: APPS_SCRIPT_URL not set.")
        return
        
    payload = {
        "action": "updateMeeting",
        "meetingId": meeting_id,
        **updates
    }
    try:
        requests.post(APPS_SCRIPT_URL, data=json.dumps(payload), headers={"Content-Type": "application/json"})
    except Exception as e:
        print(f"Error updating Google Sheets: {e}")


def call_llm_with_fallback(doc_id: str, prompt: str, json_mode: bool = True) -> str:
    """
    Calls LLM via OpenRouter with a robust fallback chain.
    """
    if not OPENROUTER_API_KEY or OPENROUTER_API_KEY == "YOUR_OPENROUTER_API_KEY":
        raise Exception("OpenRouter API Key is missing or invalid.")

    # Optimized OpenRouter models (Cheapest & Fastest first)
    LLM_MODELS = [
        "google/gemini-2.0-flash-001",   # Primary: ultra-fast, ultra-cheap
        "google/gemini-flash-1.5",       # Backup: stable reliable
        "anthropic/claude-3-haiku",      # Backup: different provider fallback
        "google/gemini-2.0-pro-exp-02-05:free"
    ]

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-meeting-assistant.vercel.app", # Recommended by OpenRouter
        "X-OpenRouter-Title": "AI Meeting Assistant"
    }

    last_error = None
    for model_name in LLM_MODELS:
        tries = 0
        max_tries = 3
        while tries < max_tries:
            try:
                print(f"[{doc_id}] Trying OpenRouter model: {model_name} (Attempt {tries + 1}/{max_tries})")
                
                payload = {
                    "model": model_name,
                    "messages": [{"role": "user", "content": prompt}]
                }
                
                if json_mode:
                    payload["response_format"] = {"type": "json_object"}
                
                response = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
                
                if response.status_code == 200:
                    data = response.json()
                    raw_text = data['choices'][0]['message']['content'].strip()
                    print(f"[{doc_id}] Success with OpenRouter model: {model_name}")
                    return raw_text
                
                # Handle specific API errors
                error_data = response.text
                if response.status_code in [429, 503, 502, 504]:
                    wait_time = (tries + 1) * 15
                    print(f"[{doc_id}] OpenRouter busy ({response.status_code}). Waiting {wait_time}s...")
                    time.sleep(wait_time)
                    tries += 1
                    continue
                else:
                    print(f"[{doc_id}] OpenRouter error {response.status_code}: {error_data}")
                    break # Try next model
                    
            except Exception as e:
                last_error = str(e)
                print(f"[{doc_id}] Request failed: {e}")
                tries += 1
                time.sleep(5)
    
    raise Exception(f"All AI models failed. Last error: {last_error}")


def process_audio_background(file_path: str, filename_without_ext: str, doc_id: str):
    """
    Background worker that transcribes audio and updates Google Sheets.
    """
    compressed_path = ""
    
    try:
        # Step 1: Compress Audio for AssemblyAI
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        compressed_path = os.path.join(TEMP_AUDIO_DIR, f"compressed_{filename_without_ext}.mp3")
        
        compress_cmd = [
            ffmpeg_exe,
            "-y",
            "-i", file_path,
            "-vn",
            "-ar", "16000",
            "-ac", "1",
            "-b:a", "32k",
            compressed_path
        ]
        
        update_meeting_in_sheets(doc_id, {
            "progress": 10,
            "status": "processing"
        })
        print(f"[{doc_id}] Compressing audio file...")
        
        process = subprocess.run(compress_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if process.returncode != 0:
            raise Exception(f"FFmpeg compression failed: {process.stderr}")
            
        
        # Step 2: Upload and Transcribe with AssemblyAI NANO (Faster/Cheaper)
        update_meeting_in_sheets(doc_id, {
            "progress": 40
        })
        print(f"[{doc_id}] High-speed Transcribing with AssemblyAI Nano...")
        
        transcriber = aai.Transcriber()
        config = aai.TranscriptionConfig(
            speaker_labels=True,
            speech_models=["universal-3-pro", "universal-2"]
        )
        
        transcript_obj = transcriber.transcribe(compressed_path, config=config)
        
        if transcript_obj.status == aai.TranscriptStatus.error:
             raise Exception(f"AssemblyAI Transcription failed: {transcript_obj.error}")
             
        # Extract Diarized utterances into SRT format
        def format_ms_to_srt(ms):
            seconds, ms = divmod(ms, 1000)
            minutes, seconds = divmod(seconds, 60)
            hours, minutes = divmod(minutes, 60)
            return f"{hours:02d}:{minutes:02d}:{seconds:02d},{ms:03d}"
            
        master_transcript = ""
        if transcript_obj.utterances:
            for idx, utterance in enumerate(transcript_obj.utterances, start=1):
                start = format_ms_to_srt(utterance.start)
                end = format_ms_to_srt(utterance.end)
                master_transcript += f"{idx}\n{start} --> {end}\n[Speaker {utterance.speaker}]: {utterance.text}\n\n"
        else:
            master_transcript = transcript_obj.export_subtitles_srt()

        # Step 3: Master Summary via Gemini (with model fallback chain)
        update_meeting_in_sheets(doc_id, {
            "progress": 85
        })
        print(f"[{doc_id}] Building Master Summary & To-Do List using Gemini...")
        
        reduce_prompt = (
            "You are a meeting assistant. Based on the following complete meeting transcript (with speaker labels), "
            "return a JSON object with strictly these keys:\n"
            "1. 'summary' (string): A concise summary strictly in English.\n"
            "2. 'action_items' (an array of objects containing 'assignee' and 'task'): Action items strictly in English. Use the speaker labels (e.g. Speaker A) for assignments if applicable.\n\n"
            f"TRANSCRIPT:\n{master_transcript}"
        )
        
        raw_text = call_llm_with_fallback(doc_id, reduce_prompt, json_mode=True)
        
        # Robust JSON cleaning (handles extra text or markdown wrappers)
        cleaned_text = raw_text.strip()
        if "```json" in cleaned_text:
            cleaned_text = cleaned_text.split("```json")[1].split("```")[0].strip()
        elif "```" in cleaned_text:
            cleaned_text = cleaned_text.split("```")[1].split("```")[0].strip()
            
        try:
            result_json = json.loads(cleaned_text, strict=False)
        except Exception as json_err:
            print(f"[{doc_id}] JSON Parse Error. Raw response: {raw_text}")
            raise json_err
        
        # Step 4: Save to Google Sheets
        print(f"[{doc_id}] Background processing COMPLETE.")
        
        update_meeting_in_sheets(doc_id, {
            "status": "completed",
            "progress": 100,
            "transcript": master_transcript,
            "summary": result_json.get("summary", ""),
            "action_items": result_json.get("action_items", [])
        })
            
    except Exception as e:
        print(f"[{doc_id}] Error in background processing: {e}")
        update_meeting_in_sheets(doc_id, {
            "status": "error",
            "summary": f"Error: {str(e)}"
        })
            
    finally:
        # Cleanup
        if os.path.exists(file_path):
            os.remove(file_path)
            
        if compressed_path and os.path.exists(compressed_path):
            os.remove(compressed_path)


@app.post("/upload-audio/")
async def upload_audio(background_tasks: BackgroundTasks, file: UploadFile = File(...), title: str = Form("Untitled Meeting"), user_id: str = Form(...)):
    """
    Receives file, pings Apps Script to create row, spawns background chunk processor, and returns ID quickly.
    """
    if not APPS_SCRIPT_URL:
        raise HTTPException(status_code=500, detail="APPS_SCRIPT_URL not configured")
        
    doc_id = None
    
    # 1. Ask Apps Script to create a new Meeting row
    try:
        response = requests.post(APPS_SCRIPT_URL, data=json.dumps({
            "action": "createMeeting",
            "userId": user_id,
            "title": title
        }), headers={"Content-Type": "application/json"})
        data = response.json()
        if not data.get("success"):
            raise Exception("Failed to create row in Sheets")
        doc_id = data.get("meetingId")
    except Exception as e:
         raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    
    # 2. Save file locally with UNIQUE ID to prevent collisions and path issues
    # Using doc_id in filename ensures FFmpeg finds the exact right file
    unique_filename = f"{doc_id}_{file.filename}"
    file_path = os.path.join(TEMP_AUDIO_DIR, unique_filename)
    
    print(f"[{doc_id}] Saving upload to absolute path: {file_path}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    filename_without_ext = f"{doc_id}_{os.path.splitext(file.filename)[0]}"
    
    # 3. Spawn background task
    background_tasks.add_task(process_audio_background, file_path, filename_without_ext, doc_id)
    
    return {
        "status": "processing",
        "document_id": doc_id
    }

class TranscriptPayload(BaseModel):
    transcript: str

@app.post("/translate-transcript/")
async def translate_transcript(payload: TranscriptPayload):
    """
    Translates any given SRT transcript into pure English maintaining the SRT formatting exactly.
    """
    try:
        prompt = (
            "You are a professional translator. I will provide you with an SRT (SubRip) subtitle format transcript. "
            "Your job is to translate absolutely everything spoken into plain English, while strictly retaining all the formatting, line breaks, timestamps, index numbers, and speaker labels ([Speaker A] etc.).\n"
            "Do not add any additional markdown or context. Just output the translated SRT script safely.\n\n"
            f"TRANSCRIPT TO TRANSLATE:\n{payload.transcript}"
        )
        translated = call_llm_with_fallback("translate", prompt, json_mode=False)
        
        # Clean any markdown code blocks
        if translated.startswith("```"):
            translated = translated.split("\n", 1)[-1]
            if translated.endswith("```"):
                 translated = translated[:-3]
        return {"translated_transcript": translated.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

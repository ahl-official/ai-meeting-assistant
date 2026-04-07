import os
import shutil
import json
import time
import subprocess
import glob
from datetime import datetime, timezone
import requests

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai
from dotenv import load_dotenv
import imageio_ffmpeg
import assemblyai as aai

# Load environment variables
load_dotenv()

# Configure the Gemini API client
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
aai.settings.api_key = os.getenv("ASSEMBLYAI_API_KEY")

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

TEMP_AUDIO_DIR = "temp_audio"
if not os.path.exists(TEMP_AUDIO_DIR):
    os.makedirs(TEMP_AUDIO_DIR)


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


def process_audio_background(file_path: str, filename_without_ext: str, doc_id: str):
    """
    Background worker that transcibes audio and updates Google Sheets.
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
        print(f"[{doc_id}] Compressing massive audio file...")
        
        process = subprocess.run(compress_cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if process.returncode != 0:
            raise Exception(f"FFmpeg compression failed: {process.stderr}")
            
        
        # Step 2: Upload and Transcribe with AssemblyAI
        update_meeting_in_sheets(doc_id, {
            "progress": 40
        })
        print(f"[{doc_id}] Uploading and Transcribing with AssemblyAI...")
        
        transcriber = aai.Transcriber()
        config = aai.TranscriptionConfig(speaker_labels=True)
        config.speech_models = ["universal-2"]
        
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
        
        # Try models in order - if one fails (quota, unavailable), try the next
        GEMINI_MODELS = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-pro-latest",
            "gemini-1.5-flash-latest",
        ]
        
        reduce_prompt = (
            "You are a meeting assistant. Based on the following complete meeting transcript (with speaker labels), "
            "return a JSON object with strictly these keys:\n"
            "1. 'summary' (string): A concise summary strictly in English.\n"
            "2. 'action_items' (an array of objects containing 'assignee' and 'task'): Action items strictly in English. Use the speaker labels (e.g. Speaker A) for assignments if applicable.\n\n"
            f"TRANSCRIPT:\n{master_transcript}"
        )
        
        raw_text = None
        last_error = None
        for model_name in GEMINI_MODELS:
            try:
                print(f"[{doc_id}] Trying Gemini model: {model_name}")
                model = genai.GenerativeModel(model_name)
                final_response = model.generate_content(
                    reduce_prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                raw_text = final_response.text.strip()
                print(f"[{doc_id}] Success with model: {model_name}")
                break  # If successful, stop trying
            except Exception as model_err:
                last_error = model_err
                print(f"[{doc_id}] Model {model_name} failed: {model_err}. Trying next...")
                continue
        
        if raw_text is None:
            raise Exception(f"All Gemini models failed. Last error: {last_error}")
        
        if raw_text.startswith("```json"):
            raw_text = raw_text[7:]
        if raw_text.endswith("```"):
            raw_text = raw_text[:-3]
            
        result_json = json.loads(raw_text.strip(), strict=False)
        
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
    
    # 2. Save file locally
    file_path = os.path.join(TEMP_AUDIO_DIR, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    filename_without_ext, _ = os.path.splitext(file.filename)
    
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
        GEMINI_MODELS = [
            "gemini-2.5-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-pro-latest",
            "gemini-1.5-flash-latest",
        ]
        prompt = (
            "You are a professional translator. I will provide you with an SRT (SubRip) subtitle format transcript. "
            "Your job is to translate absolutely everything spoken into plain English, while strictly retaining all the formatting, line breaks, timestamps, index numbers, and speaker labels ([Speaker A] etc.).\n"
            "Do not add any additional markdown or context. Just output the translated SRT script safely.\n\n"
            f"TRANSCRIPT TO TRANSLATE:\n{payload.transcript}"
        )
        translated = None
        last_err = None
        for model_name in GEMINI_MODELS:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                translated = response.text.strip()
                break
            except Exception as me:
                last_err = me
                continue
        
        if translated is None:
            raise Exception(f"All Gemini models failed: {last_err}")
        
        # Clean any markdown code blocks
        if translated.startswith("```"):
            translated = translated.split("\n", 1)[-1]
            if translated.endswith("```"):
                 translated = translated[:-3]
        return {"translated_transcript": translated.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

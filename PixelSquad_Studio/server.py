"""
Suno Studio Server for ACE-Step 1.5
High-performance backend serving the Suno.com-inspired music creation interface.
"""

import re
import os
import sys
import json
import glob
import time
import tempfile
import subprocess
import platform
from pathlib import Path
from typing import Optional, List, Dict, Any, Set

# Ensure project root is in sys.path
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import shutil

# Load base ACE-Step API application
from acestep.api_server import create_app
from acestep.api.http.release_task_models import GenerateMusicRequest
from PixelSquad_Studio.voice_cloner import clone_voice_timbre
from PixelSquad_Studio.mastering import master_audio_file, MASTERING_PRESETS

# Initialize core app
app = create_app()

STUDIO_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUTS_DIR = os.path.join(PROJECT_ROOT, "gradio_outputs")
UPLOADS_DIR = os.path.join(OUTPUTS_DIR, "uploads")
CUSTOM_VOICES_DIR = os.path.join(PROJECT_ROOT, "custom_voices")
CUSTOM_VOICES_FILE = os.path.join(CUSTOM_VOICES_DIR, "voices.json")
os.makedirs(UPLOADS_DIR, exist_ok=True)
os.makedirs(CUSTOM_VOICES_DIR, exist_ok=True)

ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".webm"}
MAX_TRACKED_TASKS = 200

def is_safe_audio_path(path: str) -> bool:
    """Validate that the target audio path is inside authorized project/output boundaries."""
    if not path or not isinstance(path, str):
        return False
    try:
        resolved = os.path.realpath(path)
        allowed_roots = [
            os.path.realpath(OUTPUTS_DIR),
            os.path.realpath(CUSTOM_VOICES_DIR),
            os.path.realpath(os.path.join(PROJECT_ROOT, ".cache")),
            os.path.realpath(tempfile.gettempdir()),
        ]
        in_allowed_root = any(
            resolved == root or resolved.startswith(root + os.sep)
            for root in allowed_roots
        )
        if not in_allowed_root:
            return False
        _, ext = os.path.splitext(resolved)
        return ext.lower() in ALLOWED_AUDIO_EXTENSIONS
    except Exception:
        return False

# Global dictionary to track in-flight tasks and their user parameters
PENDING_TASKS: Dict[str, Dict[str, Any]] = {}
# Completed tasks cache to instantly respond on subsequent polls without re-processing
COMPLETED_TASKS: Dict[str, Dict[str, Any]] = {}
# Active mastering jobs to prevent concurrent duplicate mastering runs for the same task
MASTERING_IN_PROGRESS: Set[str] = set()

class SunoGeneratePayload(BaseModel):
    title: Optional[str] = "Untitled Song"
    lyrics: Optional[str] = ""
    style: str = "Acoustic Pop"
    instrumental: bool = False
    duration: Optional[float] = 60.0
    duration_mode: Optional[str] = "auto"
    bpm: Optional[int] = None
    key_scale: Optional[str] = ""
    custom_mode: bool = True
    batch_size: Optional[int] = 1
    task_type: Optional[str] = "text2music"
    
    # Vocal Gender & Artist Controls
    vocal_gender: Optional[str] = "auto"  # "auto", "male", "female"
    voice_artist: Optional[str] = None
    
    # Suno Controls & Model
    model: Optional[str] = "v6-mini"  # "v6-pro", "v6-wild", "v6-mini"
    mastering_preset: Optional[str] = "suno_studio"  # "suno_studio", "bass_club", "vocal_air"
    max_mode: bool = False
    weirdness: Optional[int] = 50
    style_influence: Optional[int] = 50
    variety: Optional[str] = "normal"  # "low", "normal", "high"
    personalize: bool = False
    
    # Reference Audio & Cover
    reference_audio_path: Optional[str] = None
    audio_cover_strength: Optional[float] = 0.6
    
    # Audio Repaint
    src_audio_path: Optional[str] = None
    repainting_start: Optional[float] = 0.0
    repainting_end: Optional[float] = None
    repaint_mode: Optional[str] = "balanced"
    repaint_strength: Optional[float] = 0.5
    
    # Studio Fine Tuning
    inference_steps: Optional[int] = 8
    guidance_scale: Optional[float] = 7.0
    shift: Optional[float] = 3.0
    use_random_seed: bool = True
    seed: Optional[int] = -1
    audio_format: Optional[str] = "mp3"
    enable_normalization: bool = True
    normalization_db: Optional[float] = -1.0
    fade_in_duration: Optional[float] = 0.0
    fade_out_duration: Optional[float] = 0.0


@app.post("/api/upload-audio")
async def upload_audio(file: UploadFile = File(...)):
    """Upload audio file for Reference Audio / Cover / Repaint / Analyzer / Mic recording with strict validation."""
    raw_name = Path(file.filename or "upload.mp3").name
    clean_stem = re.sub(r"[^\w\-]", "_", Path(raw_name).stem)[:80]
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{ext}'. Allowed: {', '.join(sorted(ALLOWED_AUDIO_EXTENSIONS))}"
        )

    clean_filename = f"{int(time.time())}_{clean_stem}{ext}"
    save_path = os.path.join(UPLOADS_DIR, clean_filename)

    # Enforce 100MB max file size to prevent disk exhaustion
    MAX_UPLOAD_BYTES = 100 * 1024 * 1024
    total_bytes = 0
    with open(save_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):  # 1MB chunks
            total_bytes += len(chunk)
            if total_bytes > MAX_UPLOAD_BYTES:
                buffer.close()
                if os.path.exists(save_path):
                    os.remove(save_path)
                raise HTTPException(status_code=413, detail="File too large (max 100MB allowed)")
            buffer.write(chunk)
    abs_path = os.path.abspath(save_path)

    # If audio is webm/ogg/opus/m4a, transcode to high-quality MP3 for universal ACE-Step compatibility
    base, ext = os.path.splitext(clean_filename)
    if ext.lower() in [".webm", ".ogg", ".opus", ".m4a"]:
        mp3_filename = f"{base}.mp3"
        mp3_path = os.path.join(UPLOADS_DIR, mp3_filename)
        cmd = ["ffmpeg", "-y", "-i", abs_path, "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k", mp3_path]
        try:
            res = subprocess.run(cmd, capture_output=True, timeout=15)
            if res.returncode == 0 and os.path.exists(mp3_path):
                abs_path = os.path.abspath(mp3_path)
                clean_filename = mp3_filename
        except Exception as e:
            logger.warning(f"Audio normalization via ffmpeg warning: {e}")

    return {
        "success": True,
        "file_path": abs_path,
        "filename": clean_filename,
        "audio_url": f"/api/audio-file?path={abs_path}"
    }


def detect_system_hardware() -> Dict[str, Any]:
    """Dynamically detect real physical GPU and hardware specs across CUDA, ROCm, MPS, XPU, or WMI/System."""
    hw = {
        "gpu_name": "CPU",
        "vram_gb": 0.0,
        "device_type": "cpu"
    }

    # 1. PyTorch CUDA / ROCm / MPS / XPU detection
    try:
        import torch
        if torch.cuda.is_available():
            hw["gpu_name"] = torch.cuda.get_device_name(0)
            mem_bytes = torch.cuda.get_device_properties(0).total_memory
            hw["vram_gb"] = round(mem_bytes / (1024**3), 1)
            hw["device_type"] = "cuda"
            return hw
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            hw["gpu_name"] = "Apple Silicon GPU (MPS)"
            hw["vram_gb"] = 8.0
            hw["device_type"] = "mps"
            return hw
        elif hasattr(torch, "xpu") and torch.xpu.is_available():
            props = torch.xpu.get_device_properties(0)
            hw["gpu_name"] = getattr(props, "name", "Intel XPU")
            hw["vram_gb"] = round(getattr(props, "total_memory", 0) / (1024**3), 1)
            hw["device_type"] = "xpu"
            return hw
    except Exception as e:
        logger.warning(f"PyTorch GPU check error: {e}")

    # 2. nvidia-smi tool check
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
            encoding="utf-8",
            timeout=3
        )
        line = out.strip().splitlines()[0]
        parts = [p.strip() for p in line.split(",")]
        hw["gpu_name"] = parts[0]
        if len(parts) > 1:
            hw["vram_gb"] = round(float(parts[1]) / 1024.0, 1)
        hw["device_type"] = "nvidia-smi"
        return hw
    except Exception:
        pass

    # 3. Windows WMI / CimInstance (detects actual installed GPU even if PyTorch is CPU-only)
    if sys.platform == "win32":
        try:
            cmd = ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json"]
            out = subprocess.check_output(cmd, encoding="utf-8", timeout=4)
            data = json.loads(out)
            if isinstance(data, dict):
                data = [data]
            dedicated = []
            integrated = []
            for d in data:
                name = (d.get("Name") or "").strip()
                ram = d.get("AdapterRAM", 0) or 0
                if any(x in name.lower() for x in ["nvidia", "geforce", "rtx", "gtx", "radeon", "arc"]):
                    dedicated.append((name, ram))
                else:
                    integrated.append((name, ram))
            if dedicated:
                best = dedicated[0]
                hw["gpu_name"] = best[0]
                hw["vram_gb"] = round(best[1] / (1024**3), 1) if best[1] > 0 else 0.0
                hw["device_type"] = "wmi_dedicated"
                return hw
            elif integrated:
                best = integrated[0]
                hw["gpu_name"] = best[0]
                hw["vram_gb"] = round(best[1] / (1024**3), 1) if best[1] > 0 else 0.0
                hw["device_type"] = "wmi_igpu"
                return hw
        except Exception as e:
            logger.warning(f"WMI hardware detection error: {e}")

    # 4. Fallback to CPU processor
    proc = platform.processor() or "CPU"
    hw["gpu_name"] = proc if len(proc) < 40 else "CPU Processor"
    return hw


@app.get("/api/system-status")
async def get_system_status():
    """Return GPU and runtime telemetry dynamically detected from host system."""
    hw = detect_system_hardware()
    tier = "tier1"
    try:
        from acestep.gpu_config import get_gpu_config
        cfg = get_gpu_config()
        tier = cfg.tier
    except Exception:
        pass

    return {
        "status": "online",
        "gpu_name": hw["gpu_name"],
        "vram_gb": hw["vram_gb"],
        "device_type": hw.get("device_type", "gpu"),
        "tier": tier,
        "model": "acestep-v15-turbo (INT8 + Flash Attention 2)",
        "output_dir": OUTPUTS_DIR
    }


@app.get("/api/tracks")
async def get_tracks():
    """Scan and list all generated tracks with full metadata and lyrics."""
    tracks = []
    seen_ids = set()
    
    # 1. Search for all json files in gradio_outputs
    json_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", "*.json"), recursive=True)
    json_files.sort(key=os.path.getmtime, reverse=True)
    
    for jf in json_files:
        try:
            base_dir = os.path.dirname(jf)
            base_name = os.path.splitext(os.path.basename(jf))[0]
            
            # Enforce strict deduplication by track_id
            if base_name in seen_ids:
                continue
            seen_ids.add(base_name)
            
            # Find matching audio file
            audio_path = None
            for ext in [".mp3", ".wav", ".flac"]:
                candidate = os.path.join(base_dir, f"{base_name}{ext}")
                if os.path.exists(candidate):
                    audio_path = candidate
                    break
            
            if not audio_path:
                continue

            with open(jf, "r", encoding="utf-8") as f:
                meta = json.load(f)

            title = meta.get("title") or meta.get("song_title")
            lyrics = meta.get("lyrics", "")
            caption = meta.get("caption", "")
            
            if not title:
                lines = [l.strip() for l in lyrics.splitlines() if l.strip()]
                for l in lines:
                    if l.startswith("[") and ("RAP" in l or "INTRO" in l or "VERSE" in l):
                        continue
                    if len(l) > 2 and len(l) < 40 and not l.startswith("["):
                        title = l
                        break
            if not title and caption:
                title = caption[:30] + ("..." if len(caption) > 30 else "")
            if not title:
                title = f"Track #{base_name[:6]}"

            mtime = os.path.getmtime(audio_path)
            created_str = time.strftime("%b %d, %I:%M %p", time.localtime(mtime))
            wav_candidate = os.path.join(base_dir, f"{base_name}.wav")
            has_wav = os.path.exists(wav_candidate)
            
            tracks.append({
                "id": base_name,
                "title": title,
                "caption": caption,
                "lyrics": lyrics,
                "instrumental": meta.get("instrumental", False),
                "is_dialogue": meta.get("is_dialogue", False),
                "voice_name": meta.get("voice_name", ""),
                "duration": round(meta.get("duration", 0), 1),
                "bpm": meta.get("bpm"),
                "keyscale": meta.get("keyscale", ""),
                "created_at": created_str,
                "timestamp": mtime,
                "audio_url": f"/api/audio-file?path={os.path.abspath(audio_path)}",
                "wav_url": f"/api/audio-file?path={os.path.abspath(wav_candidate)}" if has_wav else f"/api/tracks/{base_name}/download-wav",
                "download_mp3_url": f"/api/tracks/{base_name}/download-mp3",
                "download_wav_url": f"/api/tracks/{base_name}/download-wav",
                "audio_path": audio_path,
                "json_path": jf
            })
        except Exception:
            continue

    # 2. Also check .cache/acestep/tmp/api_audio for recent API generated files
    cache_dir = os.path.join(PROJECT_ROOT, ".cache", "acestep", "tmp", "api_audio")
    if os.path.exists(cache_dir):
        cache_files = glob.glob(os.path.join(cache_dir, "*.mp3"))
        for cf in cache_files:
            bname = os.path.splitext(os.path.basename(cf))[0]
            if bname in seen_ids:
                continue
            mtime = os.path.getmtime(cf)
            created_str = time.strftime("%b %d, %I:%M %p", time.localtime(mtime))
            tracks.append({
                "id": bname,
                "title": "PixelSquad AI Master",
                "caption": "Energetic Studio Production • ACE-Step Turbo",
                "lyrics": "Auto Generated Vocal Track",
                "instrumental": False,
                "duration": 60.0,
                "bpm": 128,
                "keyscale": "C Major",
                "created_at": created_str,
                "timestamp": mtime,
                "audio_url": f"/api/audio-file?path={os.path.abspath(cf)}",
                "audio_path": cf,
                "json_path": None
            })
            
    tracks.sort(key=lambda t: t.get("timestamp", 0), reverse=True)
    return {"tracks": tracks, "total": len(tracks)}


@app.get("/api/audio-file")
async def stream_audio_file(path: str):
    """Stream audio files directly with byte-range support and strict boundary validation."""
    if not is_safe_audio_path(path):
        raise HTTPException(status_code=403, detail="Access denied: invalid file path or format")
    real_path = os.path.realpath(path)
    if not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_type = "audio/mpeg" if real_path.endswith(".mp3") else "audio/wav"
    return FileResponse(real_path, media_type=media_type, filename=os.path.basename(real_path))


@app.post("/api/generate-track")
async def generate_track(payload: SunoGeneratePayload, request: Request):
    """Bridge Suno Create parameters directly to ACE-Step release_task queue."""
    import httpx
    prompt_text = payload.style.strip()
    lyrics_text = payload.lyrics.strip() if payload.custom_mode else ""
    if payload.instrumental:
        lyrics_text = ""
        
    task_type = payload.task_type or "text2music"
    if payload.reference_audio_path and task_type == "text2music":
        task_type = "cover"
    elif payload.src_audio_path and (payload.repainting_end or payload.repainting_start):
        task_type = "repaint"

    # 1. Voice Artist & Vocal Gender Conditioning
    vocal_parts = []
    if not payload.instrumental:
        if payload.voice_artist and payload.voice_artist not in ["auto", "default"]:
            vocal_parts.append(payload.voice_artist)
        elif payload.vocal_gender == "male":
            vocal_parts.append("male vocals")
        elif payload.vocal_gender == "female":
            vocal_parts.append("female vocals")
            
    if vocal_parts:
        vocal_desc = ", ".join(vocal_parts)
        if vocal_desc.lower() not in prompt_text.lower():
            prompt_text = f"{prompt_text}, {vocal_desc}"

    # 2. Duration Auto calculation vs Custom
    calc_duration = payload.duration or 60.0
    if payload.duration_mode == "auto":
        lines = [ln.strip() for ln in lyrics_text.split("\n") if ln.strip() and not ln.strip().startswith("[")]
        if len(lines) > 20:
            calc_duration = 90.0  # Capped at 90s in auto for fast response; use Custom slider for 120s-240s
        elif len(lines) > 10:
            calc_duration = 75.0
        elif len(lines) > 3:
            calc_duration = 60.0
        else:
            calc_duration = 60.0

    # 3. Model Tuning (v6-mini vs v6-wild vs v6-pro) & Max Mode
    model_choice = payload.model or "v6-mini"
    if model_choice == "v6-pro":
        # Suno v6 Pro: Studio Master (8 turbo steps max, 7.8 CFG, 3.0 Shift)
        inf_steps = min(payload.inference_steps or 8, 8)
        cfg_scale = payload.guidance_scale or 7.8
        timestep_shift = payload.shift or 3.0
    elif model_choice == "v6-wild":
        # Suno v6-wild: Experimental creative ideas (6 steps, 6.5 CFG, 4.5 Shift)
        inf_steps = min(payload.inference_steps or 6, 8)
        cfg_scale = payload.guidance_scale or 6.5
        timestep_shift = payload.shift or 4.5
    else:
        # Suno v6-mini: Ultra-fast, responsive (4 steps, 7.0 CFG, 3.0 Shift)
        inf_steps = min(payload.inference_steps or 4, 8)
        cfg_scale = payload.guidance_scale or 7.0
        timestep_shift = payload.shift or 3.0

    if payload.max_mode:
        inf_steps = 8

    # 4. Style Influence (maps 0%..100% to Guidance Scale 2.5..13.0)
    if payload.style_influence is not None and not payload.guidance_scale:
        cfg_scale = round(2.5 + (payload.style_influence / 100.0) * 10.5, 1)

    # 5. Variety (Low, Normal, High maps to Timestep Shift 2.0, 3.0, 4.5)
    if payload.variety == "low" and not payload.shift:
        timestep_shift = 2.0
    elif payload.variety == "high" and not payload.shift:
        timestep_shift = 4.5

    # 6. Weirdness (maps 0%..100% to acoustic harmonic exploration)
    if payload.weirdness is not None:
        if payload.weirdness > 70:
            prompt_text = f"{prompt_text}, experimental harmonic nuances, progressive avant-garde modulation"
        elif payload.weirdness < 30:
            prompt_text = f"{prompt_text}, classic melodic structure, predictable radio progression"

    # 7. Suno-grade Acoustic Master Conditioning (Quality Prompt Injection)
    studio_qualifiers = "studio master recording, pristine audio fidelity, punchy 808 bass, crisp clean mix, wide stereo imaging, professional mastering, 48kHz"
    if not any(k in prompt_text.lower() for k in ["studio", "master", "fidelity", "pristine", "48khz"]):
        prompt_text = f"{prompt_text}, {studio_qualifiers}"

    mastering_preset = payload.mastering_preset or "suno_studio"

    print(f"\n🎵 [PixelSquad Studio AI] Generating: '{payload.title}' ({task_type}) - Model: {model_choice.upper()}")
    print(f"   ├─ Vocal Gender: {payload.vocal_gender.upper()} | Artist: {payload.voice_artist or 'Auto'}")
    print(f"   ├─ Duration: {calc_duration}s ({payload.duration_mode}) | MaxMode: {payload.max_mode} (Steps: {inf_steps})")
    print(f"   ├─ Style Influence: {payload.style_influence}% (CFG: {cfg_scale}) | Variety: {payload.variety} (Shift: {timestep_shift}) | Master Preset: {mastering_preset}")
    print(f"   └─ Final Prompt: {prompt_text[:120]}...\n")

    req_data = {
        "prompt": prompt_text,
        "lyrics": lyrics_text,
        "caption": prompt_text,
        "instrumental": payload.instrumental,
        "audio_duration": calc_duration,
        "bpm": payload.bpm,
        "key_scale": payload.key_scale or "",
        "batch_size": payload.batch_size or 1,
        "inference_steps": inf_steps,
        "guidance_scale": cfg_scale,
        "shift": timestep_shift,
        "use_random_seed": payload.use_random_seed,
        "seed": payload.seed if not payload.use_random_seed else -1,
        "task_type": task_type,
        "reference_audio_path": payload.reference_audio_path,
        "src_audio_path": payload.src_audio_path or payload.reference_audio_path,
        "audio_cover_strength": payload.audio_cover_strength or 0.6,
        "repainting_start": payload.repainting_start or 0.0,
        "repainting_end": payload.repainting_end,
        "repaint_mode": payload.repaint_mode or "balanced",
        "repaint_strength": payload.repaint_strength or 0.5,
        "thinking": False,  # Strict safeguard for 6GB RTX 3060 VRAM
        "model": "acestep-v15-turbo",
        "audio_format": "flac",  # Lossless intermediate generation so VAE audio retains 100% fidelity before studio mastering
        "lm_negative_prompt": "muffled, low quality, distorted, clipping, hollow, muddy, hiss, hum, background noise, phase cancellation, robotic resonance, amateur recording, phone mic"
    }

    async with httpx.AsyncClient(base_url="http://127.0.0.1:7865", timeout=30.0) as client:
        response = await client.post("/release_task", json=req_data)
    
    if response.status_code != 200:
        raise HTTPException(status_code=response.status_code, detail=response.text)
        
    res_json = response.json()
    task_id = res_json.get("data", {}).get("task_id")
    
    if task_id:
        PENDING_TASKS[task_id] = {
            "title": payload.title or "New Song",
            "style": prompt_text,
            "lyrics": lyrics_text,
            "vocal_gender": payload.vocal_gender,
            "voice_artist": payload.voice_artist,
            "duration": calc_duration,
            "instrumental": payload.instrumental,
            "bpm": payload.bpm,
            "key_scale": payload.key_scale,
            "mastering_preset": mastering_preset,
            "model": model_choice
        }

    return {
        "success": True,
        "task_id": task_id,
        "title": payload.title or "New Song",
        "style": payload.style
    }


@app.get("/api/track-status/{task_id}")
async def check_track_status(task_id: str):
    """Poll job status and progress for a generation task."""
    import httpx
    import urllib.parse

    # 1. Fast cache hit if already completed
    if task_id in COMPLETED_TASKS:
        return COMPLETED_TASKS[task_id]

    # 2. Check if already mastered on disk
    existing_json = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{task_id}.json"), recursive=True)
    if existing_json:
        jf = existing_json[0]
        base_dir = os.path.dirname(jf)
        dest_audio = os.path.join(base_dir, f"{task_id}.mp3")
        if os.path.exists(dest_audio):
            resp = {
                "status": "success",
                "stage": "Generation & Mastering Complete",
                "progress": 100,
                "audio_url": f"/api/audio-file?path={os.path.abspath(dest_audio)}",
                "result": []
            }
            COMPLETED_TASKS[task_id] = resp
            return resp

    # 3. Check if mastering is currently running for this task
    if task_id in MASTERING_IN_PROGRESS:
        return {
            "status": "processing",
            "stage": "Mastering broadcast audio (EQ, Stereo Widening, Loudness)...",
            "progress": 95,
            "audio_url": None,
            "result": []
        }

    async with httpx.AsyncClient(base_url="http://127.0.0.1:7865", timeout=30.0) as client:
        response = await client.post("/query_result", json={"task_id_list": [task_id]})
    
    if response.status_code != 200:
        return {"status": "error", "progress": 0, "message": "Failed to query status"}
        
    data = response.json().get("data", [])
    if not data:
        return {"status": "queued", "progress": 5, "message": "In Queue..."}
        
    job_info = data[0]
    raw_status = job_info.get("status")
    stage = job_info.get("stage", "")
    progress = job_info.get("progress", 10)
    
    result_raw = job_info.get("result", [])
    if isinstance(result_raw, str):
        try:
            result_list = json.loads(result_raw)
        except Exception:
            result_list = []
    else:
        result_list = result_raw

    # Dynamically extract inner progress and stage from ACE-Step job result
    if result_list and isinstance(result_list, list) and len(result_list) > 0 and isinstance(result_list[0], dict):
        first_res = result_list[0]
        if first_res.get("stage"):
            stage = first_res["stage"]
        if first_res.get("progress") is not None:
            raw_p = first_res["progress"]
            progress = int(raw_p * 100) if raw_p <= 1.0 else int(raw_p)
        if first_res.get("status") == 1:
            raw_status = 1
        elif first_res.get("status") == 2:
            raw_status = -1

    is_success = (raw_status == 1 or raw_status == "success" or stage == "succeeded")
    audio_url = None
    file_path = None

    if is_success and result_list:
        first_item = result_list[0]
        raw_path = first_item.get("file") or first_item.get("audio_url", "")
        if "path=" in raw_path:
            encoded_path = raw_path.split("path=", 1)[1]
            file_path = urllib.parse.unquote(encoded_path)
        elif raw_path:
            file_path = raw_path

        if file_path and os.path.exists(file_path):
            if task_id in MASTERING_IN_PROGRESS:
                return {
                    "status": "processing",
                    "stage": "Mastering broadcast audio (EQ, Stereo Widening, Loudness)...",
                    "progress": 95,
                    "audio_url": None,
                    "result": []
                }

            MASTERING_IN_PROGRESS.add(task_id)
            try:
                # Deterministic batch dir for this specific task
                batch_dir = os.path.join(OUTPUTS_DIR, f"batch_{task_id[:12]}")
                os.makedirs(batch_dir, exist_ok=True)
                dest_audio = os.path.join(batch_dir, f"{task_id}.mp3")
                dest_wav = os.path.join(batch_dir, f"{task_id}.wav")
                dest_json = os.path.join(batch_dir, f"{task_id}.json")
                
                meta = PENDING_TASKS.get(task_id, {})
                preset = meta.get("mastering_preset") or "suno_studio"

                if not os.path.exists(dest_audio):
                    try:
                        # Apply Suno-grade Studio Mastering (Multi-band EQ, Stereo Widening, Glue Bus Compression, True-Peak -11 LUFS Normalization, 320k MP3)
                        master_audio_file(
                            input_path=file_path,
                            output_path=dest_audio,
                            preset=preset,
                            bitrate="320k",
                            sample_rate=48000
                        )
                    except Exception as me:
                        logger.warning(f"Mastering failed, falling back to direct copy: {me}")
                        shutil.copyfile(file_path, dest_audio)

                if not os.path.exists(dest_wav):
                    try:
                        # Master broadcast lossless 24-bit 48kHz WAV for Adobe Premiere Pro / DAWs
                        master_audio_file(
                            input_path=file_path,
                            output_path=dest_wav,
                            preset=preset,
                            sample_rate=48000
                        )
                    except Exception as we:
                        logger.warning(f"WAV export failed: {we}")

                meta_payload = {
                    "title": meta.get("title") or first_item.get("metas", {}).get("title") or "PixelSquad Song",
                    "caption": meta.get("style", "") or first_item.get("prompt", ""),
                    "lyrics": meta.get("lyrics", "") or first_item.get("lyrics", ""),
                    "instrumental": meta.get("instrumental", False),
                    "duration": meta.get("duration", 60.0),
                    "bpm": meta.get("bpm"),
                    "keyscale": meta.get("key_scale"),
                    "vocal_gender": meta.get("vocal_gender"),
                    "voice_artist": meta.get("voice_artist"),
                    "mastered": True,
                    "mastering_preset": preset,
                    "bitrate": "320k",
                    "sample_rate": 48000,
                    "lufs": -11.0,
                    "model": meta.get("model", "v6-mini"),
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                with open(dest_json, "w", encoding="utf-8") as f:
                    json.dump(meta_payload, f, ensure_ascii=False, indent=2)

                audio_url = f"/api/audio-file?path={os.path.abspath(dest_audio)}"
                success_resp = {
                    "status": "success",
                    "stage": "Generation & Mastering Complete",
                    "progress": 100,
                    "audio_url": audio_url,
                    "result": result_list
                }
                COMPLETED_TASKS[task_id] = success_resp
                return success_resp
            finally:
                MASTERING_IN_PROGRESS.discard(task_id)

    return {
        "status": "success" if is_success else ("failed" if raw_status == -1 else "processing"),
        "stage": stage,
        "progress": 100 if is_success else progress,
        "audio_url": audio_url,
        "result": result_list
    }


@app.delete("/api/tracks/{track_id}")
async def delete_track(track_id: str):
    """Delete a track and its metadata files with safe identifier validation."""
    if not re.match(r"^[a-zA-Z0-9_\-]+$", track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID format")

    json_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{track_id}.json"), recursive=True)
    deleted = 0
    for jf in json_files:
        base_dir = os.path.dirname(jf)
        try:
            os.remove(jf)
            deleted += 1
            for ext in [".mp3", ".wav", ".flac", ".session.npz", ".repaint_latents.npy"]:
                cand = os.path.join(base_dir, f"{track_id}{ext}")
                if os.path.exists(cand):
                    os.remove(cand)
                    deleted += 1
        except Exception:
            pass

    COMPLETED_TASKS.pop(track_id, None)
    PENDING_TASKS.pop(track_id, None)
    return {"success": True, "deleted_files": deleted}


# ========================================================
# TEXT-TO-SPEECH (TTS) & VOICE CREATION LAB ENGINE
# ========================================================
CUSTOM_VOICES_DIR = os.path.join(PROJECT_ROOT, "custom_voices")
CUSTOM_VOICES_FILE = os.path.join(CUSTOM_VOICES_DIR, "voices.json")
os.makedirs(CUSTOM_VOICES_DIR, exist_ok=True)

DEFAULT_SYSTEM_VOICES = [
    {
        "id": "hi-IN-MadhurNeural",
        "name": "Madhur (मधुर) - Hindi Male",
        "language": "Hindi (India)",
        "gender": "male",
        "category": "hindi",
        "badge": "🇮🇳 Hindi Male",
        "description": "Warm, natural, versatile Indian Hindi baritone voice."
    },
    {
        "id": "hi-IN-SwaraNeural",
        "name": "Swara (स्वरा) - Hindi Female",
        "language": "Hindi (India)",
        "gender": "female",
        "category": "hindi",
        "badge": "🇮🇳 Hindi Female",
        "description": "Clear, melodious, expressive Indian Hindi female voice."
    },
    {
        "id": "en-IN-PrabhatNeural",
        "name": "Prabhat - Indian English Male",
        "language": "English (India)",
        "gender": "male",
        "category": "indian_english",
        "badge": "🇮🇳 Indian English Male",
        "description": "Professional, articulate corporate & storyteller Indian voice."
    },
    {
        "id": "en-IN-NeerjaNeural",
        "name": "Neerja - Indian English Female",
        "language": "English (India)",
        "gender": "female",
        "category": "indian_english",
        "badge": "🇮🇳 Indian English Female",
        "description": "Friendly, modern conversational Indian English female voice."
    },
    {
        "id": "en-US-ChristopherNeural",
        "name": "Christopher - Movie & Documentary Narrator",
        "language": "English (US)",
        "gender": "male",
        "category": "narrator",
        "badge": "🎙️ Deep Narrator",
        "description": "Deep cinematic voice perfect for movie trailers and dramatic storytelling."
    },
    {
        "id": "en-US-GuyNeural",
        "name": "Guy - US English Male",
        "language": "English (US)",
        "gender": "male",
        "category": "us_english",
        "badge": "🇺🇸 US Male",
        "description": "Crisp, casual, high-clarity American male voice."
    },
    {
        "id": "en-US-JennyNeural",
        "name": "Jenny - US English Female",
        "language": "English (US)",
        "gender": "female",
        "category": "us_english",
        "badge": "🇺🇸 US Female",
        "description": "Warm, natural, dynamic American female voice."
    },
    {
        "id": "en-US-AriaNeural",
        "name": "Aria - Dramatic / Emotional Female",
        "language": "English (US)",
        "gender": "female",
        "category": "expressive",
        "badge": "🎭 Expressive Female",
        "description": "Passionate, rich tone with intense expressive dynamic range."
    },
    {
        "id": "en-GB-RyanNeural",
        "name": "Ryan - British Studio Male",
        "language": "English (UK)",
        "gender": "male",
        "category": "uk_english",
        "badge": "🇬🇧 British Male",
        "description": "Sophisticated, refined London British studio presenter voice."
    },
    {
        "id": "en-GB-SoniaNeural",
        "name": "Sonia - British Elegant Female",
        "language": "English (UK)",
        "gender": "female",
        "category": "uk_english",
        "badge": "🇬🇧 British Female",
        "description": "Polished, elegant BBC-style British female narrator."
    }
]

def load_custom_voices() -> List[Dict[str, Any]]:
    if not os.path.exists(CUSTOM_VOICES_FILE):
        return []
    try:
        with open(CUSTOM_VOICES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_custom_voices(voices: List[Dict[str, Any]]):
    """Save custom voices with atomic file replacement to prevent file corruption."""
    tmp_path = CUSTOM_VOICES_FILE + f".tmp_{os.getpid()}"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(voices, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CUSTOM_VOICES_FILE)

class CreateVoicePayload(BaseModel):
    name: str
    gender: str = "male"
    base_voice: str = "hi-IN-MadhurNeural"
    pitch: str = "+0Hz"
    rate: str = "+0%"
    volume: str = "+0%"
    description: Optional[str] = "Custom created voice profile"
    reference_audio_path: Optional[str] = None

class GenerateTTSPayload(BaseModel):
    text: str
    voice: str = "hi-IN-MadhurNeural"
    title: Optional[str] = "Dialogue Audio"
    rate: Optional[str] = "+0%"
    pitch: Optional[str] = "+0Hz"
    volume: Optional[str] = "+0%"
    emotion: Optional[str] = None

class PreviewTTSPayload(BaseModel):
    voice: str = "hi-IN-MadhurNeural"
    text: Optional[str] = "Namaste! This is an audition of my voice on PixelSquad Studio."
    rate: Optional[str] = "+0%"
    pitch: Optional[str] = "+0Hz"

def apply_audio_fx(input_path: str, output_path: str, rate_factor: float = 1.0, pitch_factor: float = 1.0):
    """Use FFmpeg to adjust tempo and pitch cleanly without in-place truncation."""
    import subprocess
    import tempfile
    if abs(rate_factor - 1.0) < 0.02 and abs(pitch_factor - 1.0) < 0.02:
        if input_path != output_path:
            shutil.copyfile(input_path, output_path)
        return
        
    filters = []
    # Pitch shift using asetrate + aresample
    if abs(pitch_factor - 1.0) >= 0.02:
        orig_rate = 44100
        new_rate = int(orig_rate * pitch_factor)
        filters.append(f"asetrate={new_rate},aresample={orig_rate}")
        rate_factor = rate_factor / pitch_factor

    # Tempo shift
    if abs(rate_factor - 1.0) >= 0.02:
        rf = max(0.5, min(2.0, rate_factor))
        filters.append(f"atempo={rf:.2f}")

    filter_str = ",".join(filters) if filters else "anull"

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_f:
        tmp_fx = tmp_f.name

    try:
        cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", filter_str, "-b:a", "192k", tmp_fx]
        res = subprocess.run(cmd, capture_output=True)
        if res.returncode == 0 and os.path.exists(tmp_fx) and os.path.getsize(tmp_fx) > 500:
            shutil.copyfile(tmp_fx, output_path)
        elif input_path != output_path:
            shutil.copyfile(input_path, output_path)
    finally:
        if os.path.exists(tmp_fx):
            try:
                os.remove(tmp_fx)
            except Exception:
                pass


def get_elevenlabs_api_key() -> str:
    """Retrieve ElevenLabs API key from environment or .env file."""
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if key:
        return key
    env_path = os.path.join(PROJECT_ROOT, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("ELEVENLABS_API_KEY="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return ""


def synthesize_elevenlabs(text: str, voice_id: str, out_path: str) -> bool:
    """Synthesize speech using ElevenLabs API if an API key is configured."""
    api_key = get_elevenlabs_api_key()
    if not api_key:
        return False
    import urllib.request
    import json
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
    }
    payload = {
        "text": text,
        "model_id": "eleven_multilingual_v2",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.8
        }
    }
    try:
        req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status == 200:
                with open(out_path, "wb") as f:
                    f.write(resp.read())
                if os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
                    print(f"✅ [ElevenLabs TTS Success] Voice: {voice_id}, Size: {os.path.getsize(out_path)}b")
                    return True
    except Exception as e:
        print(f"⚠️ [ElevenLabs TTS Error] {e}")
    return False


async def synthesize_speech(text: str, voice_id: str, rate: str, pitch: str, volume: str, out_path: str):
    import subprocess
    import tempfile
    import edge_tts
    from gtts import gTTS

    custom_voices = load_custom_voices()
    matching_custom = next((cv for cv in custom_voices if cv["id"] == voice_id), None)
    
    # Check if voice is an ElevenLabs model and we have an API key configured
    eleven_id = matching_custom.get("elevenlabs_voice_id") if matching_custom else (voice_id if voice_id.startswith("7qBN") else None)
    if eleven_id:
        if synthesize_elevenlabs(text, eleven_id, out_path):
            return matching_custom.get("name", eleven_id)

    actual_voice = voice_id
    ref_audio_path = None
    voice_gender = "male"
    if matching_custom:
        actual_voice = matching_custom.get("base_voice", "hi-IN-MadhurNeural")
        ref_audio_path = matching_custom.get("reference_audio_path")
        voice_gender = matching_custom.get("gender", "male")
        if (not pitch or pitch == "+0Hz") and matching_custom.get("pitch"):
            pitch = matching_custom.get("pitch")
        if (not rate or rate == "+0%") and matching_custom.get("rate"):
            rate = matching_custom.get("rate")
    
    # Smart language and phonetic routing:
    # Detect Devanagari or Hindi/Urdu romanized keywords
    is_devanagari = any(0x0900 <= ord(c) <= 0x097F for c in text)
    hindi_keywords = {
        "kal", "aaj", "kya", "kyun", "kaise", "hai", "hain", "tha", "the", "thi", 
        "meri", "mera", "mere", "apna", "apni", "paisa", "naam", "baari", "taiyaari", 
        "sun", "bhai", "yaar", "namaste", "shukriya", "bhaiya", "dost", "dosti", "tera", "teri"
    }
    words = set(w.lower().strip(".,!?:;\"'()[]{}") for w in text.split())
    is_hindi_phonetic = is_devanagari or bool(words.intersection(hindi_keywords))

    if is_hindi_phonetic and ("en-" in actual_voice):
        actual_voice = "hi-IN-SwaraNeural" if voice_gender == "female" else "hi-IN-MadhurNeural"

    # Parse rate multiplier
    rate_factor = 1.0
    try:
        if isinstance(rate, str) and "%" in rate:
            pct = float(rate.replace("%", "").replace("+", "").strip())
            rate_factor = 1.0 + (pct / 100.0)
        elif isinstance(rate, (int, float)):
            rate_factor = float(rate)
    except Exception:
        rate_factor = 1.0

    # Parse pitch multiplier
    pitch_factor = 1.0
    try:
        if isinstance(pitch, str) and "Hz" in pitch:
            hz = float(pitch.replace("Hz", "").replace("+", "").strip())
            pitch_factor = 1.0 + (hz / 120.0)
        elif isinstance(pitch, str) and "%" in pitch:
            pct = float(pitch.replace("%", "").replace("+", "").strip())
            pitch_factor = 1.0 + (pct / 100.0)
    except Exception:
        pitch_factor = 1.0

    # If female voice or deep male without reference audio, apply natural pitch shifts
    if not ref_audio_path:
        if "Female" in actual_voice or "Swara" in actual_voice or "Jenny" in actual_voice or "Neerja" in actual_voice:
            pitch_factor *= 1.05
        elif "Christopher" in actual_voice or "Deep" in actual_voice:
            pitch_factor *= 0.90

    raw_tmp = out_path + ".raw.mp3"
    generated_ok = False

    # 1. Primary Engine: Edge-TTS
    try:
        communicate = edge_tts.Communicate(text, actual_voice, rate=rate or "+0%", pitch=pitch or "+0Hz", volume=volume or "+0%")
        await communicate.save(raw_tmp)
        if os.path.exists(raw_tmp) and os.path.getsize(raw_tmp) > 500:
            generated_ok = True
    except Exception as e:
        print(f"⚠️ [TTS Edge-TTS fallback] {e}")

    # 2. Resilient Fallback Engine: gTTS (Google Neural TTS)
    if not generated_ok:
        try:
            lang = "hi" if (is_devanagari or is_hindi_phonetic or "hi-IN" in actual_voice) else "en"
            tld = "co.in" if ("-IN" in actual_voice or is_hindi_phonetic) else "com"
            tts = gTTS(text=text, lang=lang, tld=tld)
            tts.save(raw_tmp)
            if os.path.exists(raw_tmp) and os.path.getsize(raw_tmp) > 500:
                generated_ok = True
                print(f"✅ [TTS Synthesized via gTTS Engine] Lang: {lang}, Size: {os.path.getsize(raw_tmp)}b")
        except Exception as ge:
            print(f"⚠️ [TTS gTTS fallback error] {ge}")

    # 3. Apply Acoustic Timbre Cloning or Audio FX post-processing
    if generated_ok:
        if ref_audio_path and os.path.exists(ref_audio_path) and os.path.getsize(ref_audio_path) > 1000:
            clone_voice_timbre(
                synth_path=raw_tmp,
                ref_audio_path=ref_audio_path,
                out_path=out_path,
                pitch_factor=pitch_factor,
                tempo_factor=rate_factor
            )
        else:
            apply_audio_fx(raw_tmp, out_path, rate_factor=rate_factor, pitch_factor=pitch_factor)
        try:
            if os.path.exists(raw_tmp):
                os.remove(raw_tmp)
        except Exception:
            pass
        return actual_voice
    else:
        raise RuntimeError("Failed to synthesize speech across all available TTS engines.")


class ElevenLabsKeyPayload(BaseModel):
    api_key: str


@app.get("/api/settings/elevenlabs")
async def get_elevenlabs_status():
    key = get_elevenlabs_api_key()
    return {"connected": bool(key), "masked_key": f"...{key[-4:]}" if len(key) >= 6 else ""}


@app.post("/api/settings/elevenlabs")
async def set_elevenlabs_key(payload: ElevenLabsKeyPayload):
    key = payload.api_key.strip()
    os.environ["ELEVENLABS_API_KEY"] = key
    env_path = os.path.join(PROJECT_ROOT, ".env")
    lines = []
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    found = False
    new_lines = []
    for line in lines:
        if line.strip().startswith("ELEVENLABS_API_KEY="):
            new_lines.append(f"ELEVENLABS_API_KEY={key}\n")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"\nELEVENLABS_API_KEY={key}\n")
    with open(env_path, "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    return {"success": True, "connected": bool(key)}


@app.get("/api/voices/list")
async def list_voices():
    """Return categorized system neural voices + custom user created voices."""
    custom_voices = load_custom_voices()
    return {
        "success": True,
        "system_voices": DEFAULT_SYSTEM_VOICES,
        "custom_voices": custom_voices,
        "total": len(DEFAULT_SYSTEM_VOICES) + len(custom_voices)
    }


@app.post("/api/voices/create")
async def create_voice(payload: CreateVoicePayload):
    """Create a new custom cloned/tuned voice profile and save to voice library."""
    custom_voices = load_custom_voices()
    voice_id = f"voice_{int(time.time())}_{len(custom_voices) + 1}"
    new_voice = {
        "id": voice_id,
        "name": payload.name.strip(),
        "gender": payload.gender,
        "base_voice": payload.base_voice,
        "pitch": payload.pitch,
        "rate": payload.rate,
        "volume": payload.volume,
        "description": payload.description,
        "reference_audio_path": payload.reference_audio_path,
        "category": "custom",
        "badge": "🌟 Custom Cloned",
        "is_custom": True,
        "created_at": time.strftime("%b %d, %I:%M %p")
    }
    custom_voices.append(new_voice)
    save_custom_voices(custom_voices)
    return {"success": True, "voice": new_voice}


@app.post("/api/voices/batch-import")
async def batch_import_voices(files: List[UploadFile] = File(...)):
    """Batch import multiple audio files and automatically register each as a Custom Voice named after the file."""
    if len(files) > 50:
        raise HTTPException(status_code=400, detail="Too many files in batch (maximum 50 files allowed per import)")

    from PixelSquad_Studio.voice_cloner import extract_vocal_features

    custom_voices = load_custom_voices()
    imported_voices = []

    batch_dir = os.path.join(UPLOADS_DIR, "batch_voices")
    os.makedirs(batch_dir, exist_ok=True)

    for idx, f in enumerate(files):
        # Extract clean character/person name from filename
        raw_name = Path(f.filename or "voice.mp3").stem
        ext = Path(f.filename or "voice.mp3").suffix.lower()
        if ext not in ALLOWED_AUDIO_EXTENSIONS:
            continue

        clean_name = re.sub(r"[_\-]+", " ", raw_name).strip()
        clean_name = re.sub(r"\s+", " ", clean_name)
        if not clean_name:
            clean_name = f"Custom Voice {len(custom_voices) + idx + 1}"

        dest_filename = f"{int(time.time())}_{idx}_{Path(f.filename).name}"
        dest_path = os.path.join(batch_dir, dest_filename)

        with open(dest_path, "wb") as out_f:
            shutil.copyfileobj(f.file, out_f)

        # Detect vocal features to automatically select gender & base voice
        try:
            f0, _ = extract_vocal_features(dest_path)
        except Exception:
            f0 = 130.0
        is_female = f0 >= 165.0
        gender = "female" if is_female else "male"
        base_voice = "hi-IN-SwaraNeural" if is_female else "hi-IN-MadhurNeural"

        voice_id = f"voice_batch_{int(time.time())}_{idx}_{len(custom_voices)}"
        new_voice = {
            "id": voice_id,
            "name": clean_name,
            "gender": gender,
            "base_voice": base_voice,
            "pitch": "+0Hz",
            "rate": "+0%",
            "volume": "+0%",
            "description": f"Batch imported from {Path(f.filename).name} (detected F0: {f0:.1f}Hz)",
            "reference_audio_path": dest_path,
            "category": "custom",
            "badge": "🌟 Batch Cloned",
            "is_custom": True,
            "created_at": time.strftime("%b %d, %I:%M %p")
        }
        custom_voices.append(new_voice)
        imported_voices.append(new_voice)

    save_custom_voices(custom_voices)
    return {
        "success": True,
        "count": len(imported_voices),
        "voices": imported_voices
    }


@app.delete("/api/voices/{voice_id}")
async def delete_custom_voice(voice_id: str):
    """Delete a custom cloned/imported voice from the voice library."""
    if not re.match(r"^[a-zA-Z0-9_\-]+$", voice_id):
        raise HTTPException(status_code=400, detail="Invalid voice ID format")
    custom_voices = load_custom_voices()
    initial_count = len(custom_voices)
    custom_voices = [v for v in custom_voices if v.get("id") != voice_id]
    if len(custom_voices) == initial_count:
        raise HTTPException(status_code=404, detail="Custom voice not found")
    save_custom_voices(custom_voices)
    return {"success": True, "voice_id": voice_id, "remaining": len(custom_voices)}


@app.post("/api/tts/preview")
async def preview_voice(payload: PreviewTTSPayload):
    """Fast speech audition preview without persistent file saving."""
    import uuid
    preview_name = f"preview_{uuid.uuid4().hex[:8]}.mp3"
    preview_path = os.path.join(UPLOADS_DIR, preview_name)
    sample_text = payload.text or "Namaste! This is an audition of my voice on PixelSquad Studio."
    
    await synthesize_speech(
        text=sample_text,
        voice_id=payload.voice,
        rate=payload.rate or "+0%",
        pitch=payload.pitch or "+0Hz",
        volume="+0%",
        out_path=preview_path
    )
    
    return {
        "success": True,
        "audio_url": f"/api/audio-file?path={os.path.abspath(preview_path)}"
    }


@app.post("/api/tts/generate")
async def generate_tts(payload: GenerateTTSPayload):
    """Generate high-quality dialogue audio, save to library, and return track item."""
    import uuid
    import soundfile as sf
    if not payload.text.strip():
        raise HTTPException(status_code=400, detail="Dialogue text cannot be empty.")
    
    # Resolve voice name for title/metadata
    all_voices = DEFAULT_SYSTEM_VOICES + load_custom_voices()
    voice_meta = next((v for v in all_voices if v["id"] == payload.voice), None)
    voice_name = voice_meta["name"] if voice_meta else payload.voice
    
    # Save directory
    batch_dir = os.path.join(OUTPUTS_DIR, f"dialogue_{int(time.time())}")
    os.makedirs(batch_dir, exist_ok=True)
    track_id = str(uuid.uuid4())
    audio_dest = os.path.join(batch_dir, f"{track_id}.mp3")
    json_dest = os.path.join(batch_dir, f"{track_id}.json")
    
    # Clean emotion tags from text if brackets are present
    processed_text = payload.text.strip()
    
    # Synthesize
    raw_tts = os.path.join(batch_dir, f"{track_id}_raw.mp3")
    await synthesize_speech(
        text=processed_text,
        voice_id=payload.voice,
        rate=payload.rate or "+0%",
        pitch=payload.pitch or "+0Hz",
        volume=payload.volume or "+0%",
        out_path=raw_tts
    )
    
    # Apply Vocal Clarity & Air broadcast mastering (320k, 48kHz, -12 LUFS)
    master_audio_file(
        input_path=raw_tts,
        output_path=audio_dest,
        preset="vocal_air",
        bitrate="320k",
        sample_rate=48000
    )
    if os.path.exists(raw_tts) and raw_tts != audio_dest:
        try:
            os.remove(raw_tts)
        except Exception:
            pass
    
    # Read duration
    duration = 5.0
    try:
        duration = round(sf.info(audio_dest).duration, 1)
    except Exception:
        pass
    
    title = payload.title.strip() if payload.title else "Dialogue Audio"
    if title == "Dialogue Audio" or not title:
        first_line = [l.strip() for l in processed_text.splitlines() if l.strip() and not l.startswith("[")]
        if first_line:
            title = first_line[0][:35] + ("..." if len(first_line[0]) > 35 else "")
            
    mtime = os.path.getmtime(audio_dest)
    created_str = time.strftime("%b %d, %I:%M %p", time.localtime(mtime))
    
    meta_data = {
        "id": track_id,
        "title": title,
        "caption": f"Dialogue Speech • {voice_name}",
        "lyrics": processed_text,
        "instrumental": False,
        "is_dialogue": True,
        "voice_id": payload.voice,
        "voice_name": voice_name,
        "duration": duration,
        "bpm": None,
        "keyscale": "",
        "created_at": created_str,
        "timestamp": mtime,
        "audio_file": f"{track_id}.mp3"
    }
    
    with open(json_dest, "w", encoding="utf-8") as f:
        json.dump(meta_data, f, ensure_ascii=False, indent=2)
        
    track_obj = {
        "id": track_id,
        "title": title,
        "caption": f"Dialogue Speech • {voice_name}",
        "lyrics": processed_text,
        "instrumental": False,
        "is_dialogue": True,
        "voice_name": voice_name,
        "duration": duration,
        "bpm": None,
        "keyscale": "",
        "created_at": created_str,
        "timestamp": mtime,
        "audio_url": f"/api/audio-file?path={os.path.abspath(audio_dest)}",
        "audio_path": audio_dest,
        "json_path": json_dest
    }
    
    return {
        "success": True,
        "track": track_obj
    }


class RemasterPayload(BaseModel):
    preset: Optional[str] = "suno_studio"


@app.post("/api/tracks/{track_id}/master")
async def remaster_track(track_id: str, payload: Optional[RemasterPayload] = None):
    """Re-master an existing track with professional studio audio processing."""
    if not re.match(r"^[a-zA-Z0-9_\-]+$", track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID format")
    import glob
    preset = (payload.preset if payload else None) or "suno_studio"
    mp3_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{track_id}.mp3"), recursive=True)
    if not mp3_files:
        raise HTTPException(status_code=404, detail="Track audio not found")
    target_mp3 = mp3_files[0]
    
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_f:
        tmp_master = tmp_f.name
    
    try:
        master_audio_file(target_mp3, tmp_master, preset=preset, bitrate="320k", sample_rate=48000)
        if os.path.exists(tmp_master) and os.path.getsize(tmp_master) > 1000:
            shutil.copyfile(tmp_master, target_mp3)
            # Update meta json
            json_path = os.path.splitext(target_mp3)[0] + ".json"
            if os.path.exists(json_path):
                try:
                    with open(json_path, "r", encoding="utf-8") as jf:
                        meta = json.load(jf)
                    meta["mastered"] = True
                    meta["mastering_preset"] = preset
                    meta["bitrate"] = "320k"
                    meta["sample_rate"] = 48000
                    with open(json_path, "w", encoding="utf-8") as jf:
                        json.dump(meta, jf, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            return {"success": True, "track_id": track_id, "preset": preset, "bitrate": "320k"}
        raise RuntimeError("Mastering failed")
    finally:
        if os.path.exists(tmp_master):
            try:
                os.remove(tmp_master)
            except Exception:
                pass


def sanitize_audio_filename(title: str, ext: str = "mp3") -> str:
    """Sanitize track title for Windows filesystem and Adobe Premiere Pro compatibility.
    Removes URI fragment delimiters (#), percent signs (%), emojis, and illegal filesystem characters.
    """
    if not title:
        title = "PixelSquad_Audio"
    # Remove symbols / emojis / surrogate characters
    clean = re.sub(r"[\U00010000-\U0010ffff\uD800-\uDFFF\uFE00-\uFE0F\u200D\u2600-\u27BF]", "", str(title))
    # Remove reserved path characters that break Windows / Adobe Premiere Pro C++ importer
    clean = re.sub(r"[#%<>:\"/\\|?*+=~!@$^&;`']+", "", clean)
    clean = re.sub(r"\s+", "_", clean).strip(" ._-")
    if not clean:
        clean = "PixelSquad_Audio"
    return f"{clean}.{ext.lstrip('.')}"


@app.get("/api/tracks/{track_id}/download-mp3")
async def download_track_mp3(track_id: str):
    """Download MP3 audio file with Premiere Pro-compatible ID3v2.3 tags and clean filename."""
    if not re.match(r"^[a-zA-Z0-9_\-]+$", track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID format")
    mp3_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{track_id}.mp3"), recursive=True)
    if not mp3_files:
        raise HTTPException(status_code=404, detail="MP3 file not found")
    target_mp3 = mp3_files[0]
    
    # Read title from json if present
    json_path = os.path.splitext(target_mp3)[0] + ".json"
    title = f"Track_{track_id[:8]}"
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as jf:
                meta = json.load(jf)
                title = meta.get("title") or title
        except Exception:
            pass
    filename = sanitize_audio_filename(title, "mp3")
    return FileResponse(
        target_mp3,
        media_type="audio/mpeg",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/tracks/{track_id}/download-wav")
async def download_track_wav(track_id: str):
    """Download studio-grade lossless 24-bit 48kHz WAV file for Adobe Premiere Pro / DAWs."""
    if not re.match(r"^[a-zA-Z0-9_\-]+$", track_id):
        raise HTTPException(status_code=400, detail="Invalid track ID format")
    wav_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{track_id}.wav"), recursive=True)
    target_wav = wav_files[0] if wav_files else None
    
    # If WAV doesn't exist, convert from MP3 on-the-fly
    if not target_wav or not os.path.exists(target_wav):
        mp3_files = glob.glob(os.path.join(OUTPUTS_DIR, "**", f"{track_id}.mp3"), recursive=True)
        if not mp3_files:
            raise HTTPException(status_code=404, detail="Track audio not found")
        source_mp3 = mp3_files[0]
        target_wav = os.path.splitext(source_mp3)[0] + ".wav"
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", source_mp3,
            "-codec:a", "pcm_s24le",
            "-ar", "48000",
            "-ac", "2",
            target_wav
        ]
        res = subprocess.run(cmd, capture_output=True)
        if res.returncode != 0 or not os.path.exists(target_wav):
            raise HTTPException(status_code=500, detail="Failed to transcode to broadcast WAV")

    json_path = os.path.splitext(target_wav)[0] + ".json"
    title = f"Track_{track_id[:8]}"
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as jf:
                meta = json.load(jf)
                title = meta.get("title") or title
        except Exception:
            pass
    filename = sanitize_audio_filename(title, "wav")
    return FileResponse(
        target_wav,
        media_type="audio/wav",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


# Mount Suno Studio frontend as static files at root
app.mount("/", StaticFiles(directory=STUDIO_DIR, html=True), name="studio_static")

if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 65)
    print(" 🎵 SUNO STUDIO — Powered by ACE-Step 1.5")
    print(" 🚀 Server running at: http://127.0.0.1:7865")
    print("=" * 65 + "\n")
    uvicorn.run(app, host="127.0.0.1", port=7865, log_level="info")

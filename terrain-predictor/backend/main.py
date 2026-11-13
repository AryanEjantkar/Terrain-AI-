from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import tensorflow as tf
import numpy as np
from PIL import Image
import io
import os
import json
from datetime import datetime
import requests
from pydantic import BaseModel

app = FastAPI(title="Terrain Prediction API")

# Persistent session for faster imagery fetching
session = requests.Session()

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the model (Fixed path for Cloud)
MODEL_PATH = os.path.join(os.path.dirname(__file__), "eurosat_model.h5")

try:
    model = tf.keras.models.load_model(MODEL_PATH)
    print(f"Model loaded successfully from {MODEL_PATH}")
except Exception as e:
    print(f"Error loading model: {e}")
    model = None

CLASS_NAMES = [
    "AnnualCrop", "Forest", "HerbaceousVegetation", "Highway", "Industrial",
    "Pasture", "PermanentCrop", "Residential", "River", "SeaLake"
]

@app.get("/api/status") # Moved to /api/status so the website can show up!
async def root():
    return {"status": "online", "model_loaded": model is not None}

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")
    
    try:
        # Read image
        contents = await file.read()
        return process_image(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/predict-coords")
async def predict_coords(lat: float, lon: float, zoom: int = 18):
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")
    
    try:
        # Round coordinates slightly to allow for better performance/caching
        lat = round(lat, 5)
        lon = round(lon, 5)
        
        # Calculate BBox for 64x64 area around lat/lon (EuroSAT tiles are ~640m)
        delta = 0.003 
        bbox = f"{lon-delta},{lat-delta},{lon+delta},{lat+delta}"
        
        url = f"https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox={bbox}&bboxSR=4326&size=64,64&format=jpg&f=image"
        
        response = session.get(url, timeout=2) # Use persistent session
        if response.status_code != 200:
            raise HTTPException(status_code=500, detail="Failed to fetch satellite imagery")
        
        return process_image(response.content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

def process_image(contents):
    image = Image.open(io.BytesIO(contents)).convert('RGB')
    
    # Preprocess: EuroSAT expects 64x64. Use Bilinear for speed over Lanczos.
    image = image.resize((64, 64), Image.Resampling.BILINEAR)
    
    # Try raw pixel values [0, 255]
    img_array = np.array(image).astype(np.float32)
    print(f"Input mean (Raw): {np.mean(img_array):.3f}")
    img_array = np.expand_dims(img_array, axis=0)
    
    # Predict
    predictions = model.predict(img_array)
    
    # Use raw predictions as scores
    scores = predictions[0]
    print(f"Raw scores: {scores}")
    
    # Force Softmax to get probabilities if they aren't already
    # Standard classification models often output logits (if not using activation='softmax')
    # If the sum is roughly 1.0, it's already softmaxed.
    if not (0.99 <= np.sum(scores) <= 1.01):
        scores = tf.nn.softmax(scores).numpy()

    class_idx = np.argmax(scores)
    confidence = float(np.max(scores))
    
    print(f"Prediction: {CLASS_NAMES[class_idx]} ({confidence*100:.1f}%)")
    
    return {
        "prediction": CLASS_NAMES[class_idx],
        "confidence": confidence,
        "all_scores": {CLASS_NAMES[i]: float(scores[i]) for i in range(len(CLASS_NAMES))}
    }

class FeedbackSubmission(BaseModel):
    name: str
    email: str
    category: str
    description: str

VALID_CATEGORIES = [
    "UI / Design Issue",
    "Mobile Responsiveness",
    "Map Issue",
    "Incorrect Location Results",
    "AI Prediction Issue",
    "Feature Suggestion",
    "General Feedback"
]

FEEDBACK_FILE = os.path.join(os.path.dirname(__file__), "feedback.json")

@app.post("/api/feedback")
async def submit_feedback(feedback: FeedbackSubmission):
    name = (feedback.name or "").strip()
    email = (feedback.email or "").strip()
    category = (feedback.category or "").strip()
    description = (feedback.description or "").strip()

    if not name:
        raise HTTPException(status_code=400, detail="Name is required.")
    if not email or "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="A valid email address is required.")
    if category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(VALID_CATEGORIES)}")
    if not description or len(description) < 5:
        raise HTTPException(status_code=400, detail="Description must be at least 5 characters.")

    entry = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "name": name,
        "email": email,
        "category": category,
        "description": description
    }

    feedbacks = []
    if os.path.exists(FEEDBACK_FILE):
        try:
            with open(FEEDBACK_FILE, "r", encoding="utf-8") as f:
                feedbacks = json.load(f)
                if not isinstance(feedbacks, list):
                    feedbacks = []
        except Exception:
            feedbacks = []

    feedbacks.append(entry)

    try:
        with open(FEEDBACK_FILE, "w", encoding="utf-8") as f:
            json.dump(feedbacks, f, indent=2, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save feedback: {str(e)}")

    return {"status": "success", "message": "Feedback submitted successfully"}

# Serve Frontend Static Files
# We check if the frontend/dist folder exists (built by Docker)
FRONTEND_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(FRONTEND_PATH):
    app.mount("/", StaticFiles(directory=FRONTEND_PATH, html=True), name="frontend")
    
    # Optional: Catch-all for React Routing
    @app.exception_handler(404)
    async def custom_404_handler(request, __):
        return FileResponse(os.path.join(FRONTEND_PATH, "index.html"))

if __name__ == "__main__":
    import uvicorn
    # Hugging Face Spaces uses 7860 by default
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(app, host="0.0.0.0", port=port)

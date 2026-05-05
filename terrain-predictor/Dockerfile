# Stage 1: Build React Frontend
FROM node:20-slim AS build-stage
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build FastAPI Backend
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies for OpenCV/PIL if needed
RUN apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=build-stage /app/frontend/dist ./frontend/dist

# Copy the model file (MUST be in the same folder or child)
# We expect the user to put eurosat_model.h5 in the root before building
COPY eurosat_model.h5 ./backend/eurosat_model.h5

# Expose port (Hugging Face usually uses 7860)
EXPOSE 7860

# Run the app
CMD ["python", "backend/main.py"]

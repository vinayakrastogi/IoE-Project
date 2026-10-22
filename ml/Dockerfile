FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY requirements-train.txt .
RUN pip install --no-cache-dir -r requirements-train.txt

COPY feature_engineering.py train.py retrain.py ./

CMD ["python", "train.py"]

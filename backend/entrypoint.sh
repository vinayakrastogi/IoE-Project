#!/bin/sh
set -e

echo "Waiting for database..."
python -m app.wait_for_db

echo "Running migrations..."
alembic upgrade head

echo "Seeding slots..."
python -m app.seed

echo "Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000

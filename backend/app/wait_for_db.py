import time

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError

from app.config import get_settings


def wait_for_db(max_retries: int = 30, delay_seconds: float = 2.0) -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url)
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("Database is ready.")
            return
        except OperationalError:
            print(f"Database not ready yet ({attempt}/{max_retries}), retrying in {delay_seconds}s...")
            time.sleep(delay_seconds)
    raise RuntimeError("Database did not become ready in time")


if __name__ == "__main__":
    wait_for_db()

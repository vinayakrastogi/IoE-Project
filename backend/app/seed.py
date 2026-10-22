from app.config import get_settings
from app.database import SessionLocal
from app.models.slot import Slot

SLOTS_PER_ROW = 5


def seed_slots() -> None:
    settings = get_settings()
    db = SessionLocal()
    try:
        existing = db.query(Slot).count()
        if existing > 0:
            print(f"Slots already seeded ({existing} rows), skipping.")
            return

        slots = []
        for i in range(1, settings.total_slots + 1):
            row_letter = chr(ord("A") + (i - 1) // SLOTS_PER_ROW)
            col = (i - 1) % SLOTS_PER_ROW + 1
            slots.append(Slot(index=i, label=f"{row_letter}{col}", location="Main Lot"))

        db.add_all(slots)
        db.commit()
        print(f"Seeded {len(slots)} slots.")
    finally:
        db.close()


if __name__ == "__main__":
    seed_slots()

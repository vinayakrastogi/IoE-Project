import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SlotStatus(str, enum.Enum):
    FREE = "free"
    BOOKED = "booked"
    OCCUPIED = "occupied"


class Slot(Base):
    __tablename__ = "slots"

    id: Mapped[int] = mapped_column(primary_key=True)
    index: Mapped[int] = mapped_column(Integer, unique=True, index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(20), nullable=False)
    location: Mapped[str] = mapped_column(String(50), default="Main Lot")
    status: Mapped[SlotStatus] = mapped_column(
        Enum(SlotStatus, name="slot_status", values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=SlotStatus.FREE,
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    bookings: Mapped[list["Booking"]] = relationship(back_populates="slot")

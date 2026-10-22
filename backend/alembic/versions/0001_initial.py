"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ENUM as PGEnum

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# create_type=False on both: we create the Postgres ENUM types explicitly
# below (checkfirst=True) and reuse these same objects as column types, so
# create_table must not try to CREATE TYPE a second time (it would, by
# default, and fail with "type already exists"). Using the PG-specific
# ENUM class (rather than the generic sa.Enum) is required here -- a plain
# sa.Enum gets re-adapted to the dialect's ENUM impl during DDL compilation
# and silently drops the create_type=False flag in that process.
slot_status = PGEnum("free", "booked", "occupied", name="slot_status", create_type=False)
booking_status = PGEnum(
    "pending", "active", "completed", "cancelled", "expired",
    name="booking_status", create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    PGEnum("free", "booked", "occupied", name="slot_status").create(bind, checkfirst=True)
    PGEnum(
        "pending", "active", "completed", "cancelled", "expired", name="booking_status"
    ).create(bind, checkfirst=True)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "slots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(20), nullable=False),
        sa.Column("location", sa.String(50), nullable=False, server_default="Main Lot"),
        sa.Column("status", slot_status, nullable=False, server_default="free"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_slots_index", "slots", ["index"], unique=True)

    op.create_table(
        "bookings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("slot_id", sa.Integer(), sa.ForeignKey("slots.id"), nullable=False),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=False),
        sa.Column("qr_token", sa.String(512), nullable=False),
        sa.Column("is_guest", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("guest_name", sa.String(255), nullable=True),
        sa.Column("guest_phone", sa.String(30), nullable=True),
        sa.Column("status", booking_status, nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_bookings_qr_token", "bookings", ["qr_token"], unique=True)

    op.create_table(
        "entry_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("booking_id", sa.Integer(), sa.ForeignKey("bookings.id"), nullable=False),
        sa.Column("entry_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("exit_time", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("entry_logs")
    op.drop_table("bookings")
    op.drop_table("slots")
    op.drop_table("users")
    bind = op.get_bind()
    PGEnum(name="booking_status").drop(bind, checkfirst=True)
    PGEnum(name="slot_status").drop(bind, checkfirst=True)

"""add transactions.uid (identificador estable para export/import sin duplicados)

Revision ID: a1b2c3d4e5f6
Revises: c53dd174dd58
Create Date: 2026-09-04

Añade una columna `uid` (UUID como texto) a `transactions`, la rellena para las
filas existentes y la deja NOT NULL + UNIQUE. Es la clave que usa la
importación para no duplicar transacciones.
"""
from __future__ import annotations

import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c53dd174dd58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) Añadir la columna como nullable para poder rellenar las filas existentes.
    with op.batch_alter_table("transactions") as batch:
        batch.add_column(sa.Column("uid", sa.String(), nullable=True))

    # 2) Backfill: un UUID por fila existente.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM transactions")).fetchall()
    for (row_id,) in rows:
        conn.execute(
            sa.text("UPDATE transactions SET uid = :u WHERE id = :i"),
            {"u": str(uuid.uuid4()), "i": row_id},
        )

    # 3) Hacerla NOT NULL + UNIQUE + índice.
    with op.batch_alter_table("transactions") as batch:
        batch.alter_column("uid", existing_type=sa.String(), nullable=False)
        batch.create_unique_constraint("uq_transactions_uid", ["uid"])
        batch.create_index("ix_transactions_uid", ["uid"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("transactions") as batch:
        batch.drop_index("ix_transactions_uid")
        batch.drop_constraint("uq_transactions_uid", type_="unique")
        batch.drop_column("uid")

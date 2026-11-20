"""通用模型混入。"""

from datetime import datetime

from sqlalchemy import DateTime, func
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.functions import FunctionElement
from sqlalchemy.orm import Mapped, mapped_column


class HighPrecisionCurrentTimestamp(FunctionElement):
    """Use the current timestamp at the precision of a MySQL DATETIME(6) column."""

    type = DateTime(timezone=True)
    inherit_cache = True


@compiles(HighPrecisionCurrentTimestamp)
def _compile_timestamp(_element, compiler, **_kwargs):
    return "CURRENT_TIMESTAMP(6)" if compiler.dialect.name == "mysql" else "CURRENT_TIMESTAMP"


class TimestampMixin:
    """created_at / updated_at 时间戳混入。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

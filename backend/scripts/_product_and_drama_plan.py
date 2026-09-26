"""四张新表的 DDL 清单 —— **迁移与回滚共用的唯一一份**。

四张表
======

``products`` / ``product_images`` / ``project_product_links``
    商品资产（第五类资产）的三张表，形状分别照 ``props`` / ``prop_images`` /
    ``project_prop_links``（列名、顺序、约束名、外键动作全部对齐）。

``drama_plan_drafts``
    「广告剧情流程」的草稿表（一章一行），形状照 ``shot_video_prompt_drafts``。

为什么要这个文件（而不是迁移脚本里各写一份）
============================================

``_llm_pipeline_columns.py:3-6`` 记录过一次真实事故：迁移与回滚各维护一份清单，
漂移成「迁移 11 列 / 回滚 10 列」，于是"迁移后能跑、回滚后回不到迁移前"。
所以本文件是**唯一一份**清单，``migrate`` 与 ``rollback`` 都从这里读。

DDL 与 ORM 逐列一致
===================

DDL 直接由 SQLAlchemy 生成（``CreateTable(...).compile(dialect=sqlite.dialect())``）
后粘贴，因此列名、顺序、``NOT NULL``、主键、外键的 ``ON DELETE`` 动作与 ORM 完全一致。
类型按 SQLite 方言落：``JSON → JSON``、``Boolean → BOOLEAN``、
``DateTime(timezone=True) → DATETIME``、``String(n) → VARCHAR(n)``、``Text → TEXT``。

两处**有意**的写法差异（都不影响结构，只影响 DDL 文本）：

1. ``drama_plan_drafts.plan``：SQLAlchemy 编译时会把它写成 ``"plan"``（它在某些方言里
   是关键字），这里**不加引号**——SQLite 接受裸 ``plan`` 作列名，PRAGMA 也返回 ``plan``，
   而本模块的列名解析按裸名比对，加了引号反而会被解析成 ``"plan"`` 而自检失败。
2. ``product_images.is_primary``：ORM 用的是 Python 侧 ``default=False``（与 ``PropImage``
   逐字一致），**没有** server_default，因此 DDL 里没有 ``DEFAULT 0``。
   既有 ``prop_images`` 库里的 ``DEFAULT 0`` 是当年 ``ALTER TABLE`` 加列时留下的，
   不是 ORM 声明的一部分——新表按新库口径建即可（``tests`` 也不比对 default）。
"""

from __future__ import annotations

from dataclasses import dataclass

PRODUCTS_TABLE = "products"
PRODUCT_IMAGES_TABLE = "product_images"
PROJECT_PRODUCT_LINKS_TABLE = "project_product_links"
DRAMA_PLAN_DRAFTS_TABLE = "drama_plan_drafts"

PRODUCTS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    style VARCHAR(32) NOT NULL,
    view_count INTEGER NOT NULL,
    tags JSON NOT NULL,
    image_prompts JSON NOT NULL,
    prompt_template_id VARCHAR(64),
    visual_style VARCHAR(16) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_products_name UNIQUE (name),
    FOREIGN KEY(prompt_template_id) REFERENCES prompt_templates (id) ON DELETE SET NULL
)
""".strip()

PRODUCTS_TABLE_INDEXES: tuple[str, ...] = (
    f"CREATE INDEX IF NOT EXISTS ix_{PRODUCTS_TABLE}_name ON {PRODUCTS_TABLE} (name)",
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PRODUCTS_TABLE}_prompt_template_id "
        f"ON {PRODUCTS_TABLE} (prompt_template_id)"
    ),
)

PRODUCTS_TABLE_COLUMNS: tuple[str, ...] = (
    "id",
    "name",
    "description",
    "style",
    "view_count",
    "tags",
    "image_prompts",
    "prompt_template_id",
    "visual_style",
    "created_at",
    "updated_at",
)

PRODUCTS_TABLE_UNIQUE_CONSTRAINT = "CONSTRAINT uq_products_name UNIQUE (name)"

PRODUCT_IMAGES_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS product_images (
    id INTEGER NOT NULL,
    product_id VARCHAR(64) NOT NULL,
    file_id VARCHAR(64),
    quality_level VARCHAR(16) NOT NULL,
    view_angle VARCHAR(32) NOT NULL,
    width INTEGER,
    height INTEGER,
    format VARCHAR(32) NOT NULL,
    is_primary BOOLEAN NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_product_images_quality_angle UNIQUE (product_id, quality_level, view_angle),
    FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE,
    FOREIGN KEY(file_id) REFERENCES files (id) ON DELETE CASCADE
)
""".strip()

PRODUCT_IMAGES_TABLE_INDEXES: tuple[str, ...] = (
    f"CREATE INDEX IF NOT EXISTS ix_{PRODUCT_IMAGES_TABLE}_file_id ON {PRODUCT_IMAGES_TABLE} (file_id)",
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PRODUCT_IMAGES_TABLE}_product_id "
        f"ON {PRODUCT_IMAGES_TABLE} (product_id)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PRODUCT_IMAGES_TABLE}_quality_level "
        f"ON {PRODUCT_IMAGES_TABLE} (quality_level)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PRODUCT_IMAGES_TABLE}_view_angle "
        f"ON {PRODUCT_IMAGES_TABLE} (view_angle)"
    ),
)

PRODUCT_IMAGES_TABLE_COLUMNS: tuple[str, ...] = (
    "id",
    "product_id",
    "file_id",
    "quality_level",
    "view_angle",
    "width",
    "height",
    "format",
    "is_primary",
    "created_at",
    "updated_at",
)

PRODUCT_IMAGES_TABLE_UNIQUE_CONSTRAINT = (
    "CONSTRAINT uq_product_images_quality_angle UNIQUE (product_id, quality_level, view_angle)"
)

PROJECT_PRODUCT_LINKS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS project_product_links (
    id INTEGER NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    chapter_id VARCHAR(64),
    shot_id VARCHAR(64),
    product_id VARCHAR(64) NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT uq_project_product_links_product_scope UNIQUE (product_id, project_id, chapter_id, shot_id),
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY(chapter_id) REFERENCES chapters (id) ON DELETE SET NULL,
    FOREIGN KEY(shot_id) REFERENCES shots (id) ON DELETE SET NULL,
    FOREIGN KEY(product_id) REFERENCES products (id) ON DELETE CASCADE
)
""".strip()

PROJECT_PRODUCT_LINKS_TABLE_INDEXES: tuple[str, ...] = (
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PROJECT_PRODUCT_LINKS_TABLE}_chapter_id "
        f"ON {PROJECT_PRODUCT_LINKS_TABLE} (chapter_id)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PROJECT_PRODUCT_LINKS_TABLE}_product_id "
        f"ON {PROJECT_PRODUCT_LINKS_TABLE} (product_id)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PROJECT_PRODUCT_LINKS_TABLE}_project_id "
        f"ON {PROJECT_PRODUCT_LINKS_TABLE} (project_id)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{PROJECT_PRODUCT_LINKS_TABLE}_shot_id "
        f"ON {PROJECT_PRODUCT_LINKS_TABLE} (shot_id)"
    ),
)

PROJECT_PRODUCT_LINKS_TABLE_COLUMNS: tuple[str, ...] = (
    "id",
    "project_id",
    "chapter_id",
    "shot_id",
    "product_id",
    "created_at",
    "updated_at",
)

PROJECT_PRODUCT_LINKS_TABLE_UNIQUE_CONSTRAINT = (
    "CONSTRAINT uq_project_product_links_product_scope "
    "UNIQUE (product_id, project_id, chapter_id, shot_id)"
)

DRAMA_PLAN_DRAFTS_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS drama_plan_drafts (
    chapter_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL,
    brief JSON NOT NULL,
    plan JSON NOT NULL,
    status VARCHAR(16) NOT NULL,
    error TEXT NOT NULL,
    model VARCHAR(128) NOT NULL,
    meta JSON NOT NULL,
    claim_token VARCHAR(64),
    claim_expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    PRIMARY KEY (chapter_id),
    FOREIGN KEY(chapter_id) REFERENCES chapters (id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects (id) ON DELETE CASCADE
)
""".strip()

DRAMA_PLAN_DRAFTS_TABLE_INDEXES: tuple[str, ...] = (
    (
        f"CREATE INDEX IF NOT EXISTS ix_{DRAMA_PLAN_DRAFTS_TABLE}_project_id "
        f"ON {DRAMA_PLAN_DRAFTS_TABLE} (project_id)"
    ),
    (
        f"CREATE INDEX IF NOT EXISTS ix_{DRAMA_PLAN_DRAFTS_TABLE}_status "
        f"ON {DRAMA_PLAN_DRAFTS_TABLE} (status)"
    ),
)

DRAMA_PLAN_DRAFTS_TABLE_COLUMNS: tuple[str, ...] = (
    "chapter_id",
    "project_id",
    "brief",
    "plan",
    "status",
    "error",
    "model",
    "meta",
    "claim_token",
    "claim_expires_at",
    "created_at",
    "updated_at",
)


@dataclass(frozen=True, slots=True)
class NewTable:
    """一张新增表。

    - ``ddl``：``CREATE TABLE IF NOT EXISTS ...`` 的完整定义（迁移用）；列名顺序与 ORM 一致；
    - ``indexes``：建表后按顺序执行的 ``CREATE INDEX IF NOT EXISTS ...``；
    - ``columns``：期望的列名（按 ORM 声明顺序）—— 迁移后逐列校验、测试比对 ORM 都用它；
    - ``constraints``：命名的唯一约束（迁移后校验"约束名真的在表定义里"）；
    - ``why``：为什么要这张表（迁移输出与文档引用，避免"加了张看不懂的表"）；
    - 回滚只需要 ``table``（``DROP TABLE IF EXISTS`` 会连索引一起删）。
    """

    table: str
    ddl: str
    indexes: tuple[str, ...]
    columns: tuple[str, ...]
    constraints: tuple[str, ...]
    why: str


TABLES: tuple[NewTable, ...] = (
    NewTable(
        PRODUCTS_TABLE,
        PRODUCTS_TABLE_DDL,
        PRODUCTS_TABLE_INDEXES,
        PRODUCTS_TABLE_COLUMNS,
        ("uq_products_name",),
        "商品资产（第五类资产，全局资产：表里不放 project_id）",
    ),
    NewTable(
        PRODUCT_IMAGES_TABLE,
        PRODUCT_IMAGES_TABLE_DDL,
        PRODUCT_IMAGES_TABLE_INDEXES,
        PRODUCT_IMAGES_TABLE_COLUMNS,
        ("uq_product_images_quality_angle",),
        "商品图片（多角度/多精度）；MVP 由用户手动上传 + 手动定版，定版图进帧参考",
    ),
    NewTable(
        PROJECT_PRODUCT_LINKS_TABLE,
        PROJECT_PRODUCT_LINKS_TABLE_DDL,
        PROJECT_PRODUCT_LINKS_TABLE_INDEXES,
        PROJECT_PRODUCT_LINKS_TABLE_COLUMNS,
        ("uq_project_product_links_product_scope",),
        "项目/章节/镜头 -> 商品关联（三档作用域）；shot 档行数即「至少一半镜头」的判定依据",
    ),
    NewTable(
        DRAMA_PLAN_DRAFTS_TABLE,
        DRAMA_PLAN_DRAFTS_TABLE_DDL,
        DRAMA_PLAN_DRAFTS_TABLE_INDEXES,
        DRAMA_PLAN_DRAFTS_TABLE_COLUMNS,
        (),
        "剧情方案草稿（一章一行）：brief 免费可存、plan 只有生成成功才写、租约防重复付费",
    ),
)

TABLE_NAMES: tuple[str, ...] = (
    PRODUCTS_TABLE,
    PRODUCT_IMAGES_TABLE,
    PROJECT_PRODUCT_LINKS_TABLE,
    DRAMA_PLAN_DRAFTS_TABLE,
)


def table_count() -> int:
    """清单里的表数（输出文案一律用它，不在别处写死数字）。"""
    return len(TABLES)


def table_names() -> tuple[str, ...]:
    """清单里的表名（建表顺序）—— 回滚与校验用。"""
    return TABLE_NAMES


def columns_of(table: str) -> tuple[str, ...]:
    """某张表期望的列名（按 ORM 声明顺序）；表不在清单里时抛 ``KeyError``。"""
    for item in TABLES:
        if item.table == table:
            return item.columns
    raise KeyError(f"清单里没有这张表：{table}")


def index_names(item: NewTable) -> tuple[str, ...]:
    """从 ``CREATE INDEX IF NOT EXISTS <名字> ON ...`` 里取出索引名（校验用）。"""
    names: list[str] = []
    for ddl in item.indexes:
        parts = ddl.replace("IF NOT EXISTS", " ").split()
        names.append(parts[2])
    return tuple(names)


def describe() -> str:
    """一行人类可读概览，例如 ``4 张表：products（11 列） / ...``。"""
    parts = " / ".join(f"{item.table}（{len(item.columns)} 列）" for item in TABLES)
    return f"{table_count()} 张表：{parts}"


_DDL_CLAUSE_PREFIXES = (
    "PRIMARY KEY",
    "FOREIGN KEY",
    "UNIQUE",
    "CONSTRAINT",
    "CHECK",
    ")",
)


def _ddl_column_names(ddl: str) -> tuple[str, ...]:
    """从 ``CREATE TABLE`` DDL 里解析出列名（跳过主键/外键/唯一约束等表级子句）。"""
    names: list[str] = []
    for raw_line in ddl.splitlines()[1:]:
        line = raw_line.strip().rstrip(",")
        if not line or line.startswith(_DDL_CLAUSE_PREFIXES):
            continue
        names.append(line.split()[0])
    return tuple(names)


def _self_check() -> None:
    """模块自检：DDL 的列/表头必须与声明的列清单一致，建表顺序必须满足外键依赖。

    清单只有一份，所以这里宁可 import 时就报错，也不让"清单说的列"和"真实建出来的列"
    悄悄漂移（测试也会比对，但脚本单独跑时也要拦住）。
    """
    for item in TABLES:
        header = f"CREATE TABLE IF NOT EXISTS {item.table} ("
        if header not in item.ddl:
            raise AssertionError(f"{item.table} 的 DDL 表头与表名对不上：{item.ddl.splitlines()[0]}")
        parsed = _ddl_column_names(item.ddl)
        if parsed != item.columns:
            raise AssertionError(f"{item.table} 的 DDL 列与清单列不一致：DDL={parsed} 清单={item.columns}")
        for name in item.constraints:
            if name not in item.ddl:
                raise AssertionError(f"{item.table} 缺少唯一约束 {name}")
    # 外键依赖：product_images / project_product_links 都指向 products，所以 products 必须最先建
    if table_names() != TABLE_NAMES or TABLE_NAMES[0] != PRODUCTS_TABLE:
        raise AssertionError("建表顺序必须是 products 最先（另外两张表的外键指向它）")


_self_check()


__all__ = [
    "DRAMA_PLAN_DRAFTS_TABLE",
    "DRAMA_PLAN_DRAFTS_TABLE_COLUMNS",
    "DRAMA_PLAN_DRAFTS_TABLE_DDL",
    "DRAMA_PLAN_DRAFTS_TABLE_INDEXES",
    "NewTable",
    "PRODUCTS_TABLE",
    "PRODUCTS_TABLE_COLUMNS",
    "PRODUCTS_TABLE_DDL",
    "PRODUCTS_TABLE_INDEXES",
    "PRODUCTS_TABLE_UNIQUE_CONSTRAINT",
    "PRODUCT_IMAGES_TABLE",
    "PRODUCT_IMAGES_TABLE_COLUMNS",
    "PRODUCT_IMAGES_TABLE_DDL",
    "PRODUCT_IMAGES_TABLE_INDEXES",
    "PRODUCT_IMAGES_TABLE_UNIQUE_CONSTRAINT",
    "PROJECT_PRODUCT_LINKS_TABLE",
    "PROJECT_PRODUCT_LINKS_TABLE_COLUMNS",
    "PROJECT_PRODUCT_LINKS_TABLE_DDL",
    "PROJECT_PRODUCT_LINKS_TABLE_INDEXES",
    "PROJECT_PRODUCT_LINKS_TABLE_UNIQUE_CONSTRAINT",
    "TABLES",
    "TABLE_NAMES",
    "columns_of",
    "describe",
    "index_names",
    "table_count",
    "table_names",
]

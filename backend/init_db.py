"""开发初始化也使用正式迁移链，避免 create_all 绕过版本和数据变更。"""

from app.scripts.migrate_database import migrate_database

if __name__ == "__main__":
    migrate_database()

"""Decode grouped check replies while keeping valid observations independent."""
import json
from collections import Counter

from pydantic import BaseModel, ValidationError


def parse_group_reply[Answer: BaseModel](content: object, model: type[Answer], item_ids) -> list[Answer]:
    """Accept each unique, valid requested row. An invalid sibling has no verdict."""
    if not isinstance(content, str):
        return []
    try:
        envelope = json.loads(content)
    except (ValueError, RecursionError):
        return []
    if not isinstance(envelope, dict) or envelope.keys() != {'results'} or not isinstance(envelope['results'], list):
        return []
    rows = [row for row in envelope['results']
            if isinstance(row, dict) and isinstance(row.get('item_id'), str) and row['item_id'] in item_ids]
    counts = Counter(row['item_id'] for row in rows)
    answers = []
    for row in rows:
        if counts[row['item_id']] == 1:
            try:
                answers.append(model.model_validate(row))
            except ValidationError:
                continue
    return answers

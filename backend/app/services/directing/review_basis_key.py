"""固定审片依据的内部索引，不保存 graph 或改变适用性规则。"""
from fractions import Fraction
from hashlib import sha256
import json


def review_basis_key(value):
    """按 Python JSON 值相等语义规范化；数值 1、1.0、True 等价。"""
    def normalized(item):
        if isinstance(item, dict):
            return ['object', [[key, normalized(child)] for key, child in sorted(item.items())]]
        if isinstance(item, list):
            return ['array', [normalized(child) for child in item]]
        if isinstance(item, (bool, int, float)):
            return ['number', str(Fraction(item))]
        return item
    encoded = json.dumps(normalized(value), ensure_ascii=False, separators=(',', ':'))
    return sha256(encoded.encode('utf-8')).hexdigest()

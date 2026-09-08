import random
from typing import List

def generate_data(count: int = 10, min_val: float = 1.0, max_val: float = 100.0) -> List[float]:
    """Generates a list of random float data points rounded to two decimal places."""
    return [round(random.uniform(min_val, max_val), 2) for _ in range(count)]

if __name__ == "__main__":
    data = generate_data()
    print("Generated Data Points:")
    print(data)

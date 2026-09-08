import statistics
from typing import List, Tuple
from generator import generate_data

def process_data(data: List[float]) -> Tuple[float, float]:
    """Calculates average and median of a list of numbers."""
    if not data:
        raise ValueError("Data list cannot be empty.")
    
    avg = statistics.mean(data)
    med = statistics.median(data)
    return round(avg, 2), round(med, 2)

if __name__ == "__main__":
    data_points = generate_data(10)
    avg, med = process_data(data_points)
    
    print("Data Points:", data_points)
    print(f"Average: {avg}")
    print(f"Median:  {med}")

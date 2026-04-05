import json
import csv
from itertools import zip_longest

# 1. Load your JSON data
try:
    with open('data.json', 'r', encoding='utf-8') as file:
        data = json.load(file)
except FileNotFoundError:
    print("Error: 'data.json' not found.")
    exit()

# 2. Prepare the lists for each column
# Flattening Colors: Group - Color
colors_list = []
for item in data['vehicle_colors']:
    for color in item['colors']:
        colors_list.append(f"{item['group']}: {color}")

# Flattening Car Data: Brand - Model
cars_list = []
for brand, models in data['CAR_DATA'].items():
    if not models:
        cars_list.append(f"{brand}: N/A")
    for model in models:
        cars_list.append(f"{brand}: {model}")

# Registration Types and PDB
reg_types = data['registration_types']
pdb_parts = data['PDB']

# 3. Combine them into one CSV and add a unique ID
header = ['id', 'Vehicle Colors', 'Registration Types', 'PDB (Parts)', 'Car Models']
combined_rows = zip_longest(colors_list, reg_types, pdb_parts, cars_list, fillvalue='')

with open('combined_data.csv', 'w', newline='', encoding='utf-8-sig') as f:
    writer = csv.writer(f)
    writer.writerow(header)
    
    # Adding an incrementing ID (1, 2, 3...) for each row
    for i, row in enumerate(combined_rows, start=1):
        writer.writerow([i] + list(row))

print("Success! 'combined_data.csv' created with an 'id' column for your database.")
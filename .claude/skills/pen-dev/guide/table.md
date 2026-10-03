# Table

- Tables follow strict hierarchy: **Table (frame) → Table Row (frame) → Table Cell (frame) → Table Cell Content**
- Use the following rules **only when there is no predefined Table component or Table frame** in the design system or document.
- Table responsive multi screen design: Unless specifically defined, when converting a wide multi-column table to a mobile version, consider using cards instead of table
- Tables need to use flex box layout.
- CRITICAL: Each cell is represented as a **frame** node and contains a cell content, which is usually text, label, button or instance of a component.
- **Antipattern** – Do NOT put content directly in the row, skipping the cell frame:

```js
tableRowId=Insert("kdl58",{type:"frame",layout:"horizontal"})
Insert(tableRowId,{type:"text",content:"John Doe"})
Insert(tableRowId,{type:"text",content:"joe.doe@example.com"})
```


## Table Hierarchy
```
Table (frame, vertical layout)
├── Header Row (frame, horizontal, width: fill_container, height: fixed)
│   ├── Cell (frame, width: fixed, height: fill_container)
│   │   └── Text (text, bold, textGrowth: fixed-width)
│   ├── Cell (frame, width: fixed, height: fill_container)
│   │   └── Text (text, bold, textGrowth: fixed-width)
│   └── ...
├── Data Row (frame, horizontal, width: fill_container, height: fixed)
│   ├── Cell (frame, width: fixed, height: fill_container)
│   │   └── Text (text, textGrowth: fixed-width)
│   ├── Cell (frame, width: fixed, height: fill_container)
│   │   └── Text (text, textGrowth: fixed-width)
│   └── ...
├── Data Row ...
└── ...
```

- If the user does not specify data, generate **dummy placeholder values** for each cell.
- Cells may contain other components (e.g., label, button) instead of text if explicitly requested.

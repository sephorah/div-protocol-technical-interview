import sys

def get_start(map: list[list[str]]) -> tuple[int, int]:
    for i, line in enumerate(map):
        if "^" in line:
            j = line.index('^')
            return (i, j)
    return (-1, -1)

def find_obstacles(map: list[list[str]], i: int, j: int, rows: int, columns: int) -> bool:
    if map[i][j] == "^" and not is_out_of_bounds(i - 1, j, rows, columns) and \
        map[i - 1][j] == "#":
        return True
    elif map[i][j] == ">" and not is_out_of_bounds(i, j + 1, rows, columns) and \
        map[i][j + 1] == "#":
        return True
    elif map[i][j] == "v" and not is_out_of_bounds(i + 1, j, rows, columns) and \
        map[i + 1][j] == "#":
        return True
    elif map[i][j] == "<" and not is_out_of_bounds(i, j - 1, rows, columns) and \
        map[i][j - 1] == "#":
        return True
    else:
        return False

def is_out_of_bounds(i: int, j: int, rows: int, columns: int) -> bool:
    if not 0 <= i <= rows:
        return True
    elif not 0 <= j <= columns:
        return True
    else:
        return False

def update_distinct_elements_list(map: list[list[str]], i: int, j: int, elem_list: list[list[tuple[int, int]]]) -> None:
    if (i, j) in elem_list:
        map[i][j] = "+"
    else:
        elem_list.append((i,j))

def move_forward(map: list[list[str]], i: int, j: int, rows: int, columns: int, distinct_positions: list[tuple[int, int]]) -> tuple[int, int]:
    if map[i][j] == "^" and not is_out_of_bounds(i - 1, j, rows, columns) and \
        map[i - 1][j] != "#":
        update_distinct_elements_list(map, i, j, distinct_positions)
        map[i][j] = "|"
        map[i - 1][j] = '^'
        return (i - 1, j)
    elif map[i][j] == ">" and not is_out_of_bounds(i, j + 1, rows, columns) and \
        map[i][j + 1] != "#":
        map[i][j] = "-"
        update_distinct_elements_list(map, i, j, distinct_positions)
        map[i][j + 1] = '>'
        return (i, j + 1)
    elif map[i][j] == "v" and not is_out_of_bounds(i + 1, j, rows, columns) and \
        map[i + 1][j] != "#":
        update_distinct_elements_list(map, i, j, distinct_positions)
        map[i][j] = "|"
        map[i + 1][j] = 'v'
        return (i + 1, j)
    elif map[i][j] == "<" and not is_out_of_bounds(i, j - 1, rows, columns) and \
        map[i][j - 1] != "#":
        update_distinct_elements_list(map, i, j, distinct_positions)
        map[i][j] = "-"
        map[i][j - 1] = '<'
        return (i, j - 1)
    return (i, j)

def rotate(map: list[list[str]], i: int, j: int, rotations: list[int]):
    if map[i][j] == "^":
        if (i, j) not in rotations:
            rotations.append((i, j))
        map[i][j] = ">"
    elif map[i][j] == ">":
        if (i, j) not in rotations:
            rotations.append((i, j))
        # map[i][j - 1] = "+"
        map[i][j] = "v"
    elif map[i][j] == "v":
        if (i, j) not in rotations:
            rotations.append((i, j))
        # map[i - 1][j] = "+"
        map[i][j] = "<"
    elif map[i][j] == "<":
        if (i, j) not in rotations:
            rotations.append((i, j))
        # map[i][j + 1] = "+"
        map[i][j] = "^"
    

def main():
    try:
        filename = sys.argv[1]

        with open(filename, "r") as file:
            map: list[list[str]] = [list(line.strip("\n")) for line in file.readlines()]
        distinct_positions = []
        distinct_rotations = []
        rows = len(map) - 1
        columns = len(map[0]) - 1
        start = get_start(map)
        i = start[0]
        j = start[1]
        while True:
            if find_obstacles(map, i, j, rows, columns):
                rotate(map, i, j, distinct_rotations)
            else:
                new_pos = move_forward(map, i, j, rows, columns, distinct_positions)
                if new_pos == (i, j):
                    break
                i = new_pos[0]
                j = new_pos[1]
            print("Map")
            for line in map:
                print("".join(line))
        for (i, j) in distinct_rotations:
            map[i][j] = "+"
        print("Final map")
        for line in map:
            print("".join(line))
        print(len(distinct_positions)+1)
    except Exception as error:
        print(error)


if __name__ == "__main__":
    main()
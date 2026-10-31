import heapq
import json
import math
import struct
import subprocess
import sys
import time
from pathlib import Path

# Add tools to sys.path
sys.path.insert(0, str(Path(__file__).parent))
import combat_actuator as ca
import scan_creatures as sc

OTMM_PATH = r"C:\Users\yago\AppData\Roaming\PokeAlliance\PokeAllianceV3\minimap854.otmm"
PLAYER_VA = 0x1e600eb0920

def load_minimap_grid(z, min_x=1200, max_x=3400, min_y=1300, max_y=2300):
    cmd = ["node", "-e", f"""
    const {{ OtmmReader }} = require('./reconstruction/otmm.cjs');
    const r = new OtmmReader({json.dumps(OTMM_PATH)});
    const walkable = [];
    for (let y = {min_y}; y <= {max_y}; y++) {{
        for (let x = {min_x}; x <= {max_x}; x++) {{
            const t = r.tile({{x, y, z: {z}}});
            if (t && t.walkable) walkable.push([x, y]);
        }}
    }}
    console.log(JSON.stringify(walkable));
    """]
    res = subprocess.check_output(cmd, cwd=r"C:\Users\yago\Documents\Clone\RECONSTRUÇAO OFIcial")
    tiles = set((x, y) for x, y in json.loads(res.decode('utf-8')))
    return tiles

def find_path(start, goal, walkable):
    frontier = [(0, start)]
    came_from = {start: None}
    cost_so_far = {start: 0}
    
    moves = [
        (0, -1, 0), # Up
        (1, 0, 1),  # Right
        (0, 1, 2),  # Down
        (-1, 0, 3)  # Left
    ]
    
    while frontier:
        _, current = heapq.heappop(frontier)
        if current == goal:
            break
            
        cx, cy = current
        for dx, dy, dcode in moves:
            nxt = (cx + dx, cy + dy)
            if nxt not in walkable and nxt != goal:
                continue
            new_cost = cost_so_far[current] + 1
            if nxt not in cost_so_far or new_cost < cost_so_far[nxt]:
                cost_so_far[nxt] = new_cost
                priority = new_cost + abs(nxt[0] - goal[0]) + abs(nxt[1] - goal[1])
                heapq.heappush(frontier, (priority, nxt))
                came_from[nxt] = (current, dcode)
                
    if goal not in came_from:
        return None
        
    path = []
    curr = goal
    while curr != start:
        prev, dcode = came_from[curr]
        path.append((curr, dcode))
        curr = prev
    path.reverse()
    return path

def get_live_player(handle, pid):
    raw = sc.read_mem(handle, PLAYER_VA + 0x30, 12)
    if not raw or len(raw) < 10:
        return None
    x, y, z = struct.unpack_from('<iih', raw, 0)
    return {"x": x, "y": y, "z": z}

def send_direction(pid, dcode):
    cmd = [sys.executable, str(Path(__file__).parent / "walker_input.py"), "--pid", str(pid), "--direction", str(dcode)]
    subprocess.run(cmd, capture_output=True)

def send_f5_attack(pid):
    import ctypes
    user = ctypes.windll.user32
    hDesk = user.OpenDesktopW('Default', 0, False, 0x1FF)
    if hDesk:
        user.SetThreadDesktop(hDesk)
    VK_F5 = 0x74
    user.keybd_event(VK_F5, 0, 0, 0)
    time.sleep(0.05)
    user.keybd_event(VK_F5, 0, 2, 0)
    time.sleep(0.1)

def navigate_to(pid, goal_x, goal_y, max_iters=250):
    handle = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not handle:
        print("Cannot open process")
        return False
        
    p = get_live_player(handle, pid)
    if not p:
        print("Cannot get player pos")
        sc.k32.CloseHandle(handle)
        return False
        
    print(f"Starting navigation from ({p['x']}, {p['y']}, {p['z']}) to ({goal_x}, {goal_y})")
    min_x = min(p['x'], goal_x) - 30
    max_x = max(p['x'], goal_x) + 30
    min_y = min(p['y'], goal_y) - 30
    max_y = max(p['y'], goal_y) + 30
    walkable = load_minimap_grid(p['z'], min_x, max_x, min_y, max_y)
    
    last_pos = (p['x'], p['y'])
    stuck_count = 0
    
    for it in range(max_iters):
        p = get_live_player(handle, pid)
        curr = (p['x'], p['y'])
        if curr == (goal_x, goal_y):
            print(f"Goal reached at {curr}!")
            sc.k32.CloseHandle(handle)
            return True
            
        if curr == last_pos:
            stuck_count += 1
        else:
            stuck_count = 0
            last_pos = curr
            
        if stuck_count >= 2:
            print(f"Stuck at {curr}, sending F5 attack to clear path...")
            send_f5_attack(pid)
            stuck_count = 0
            time.sleep(0.3)
            
        path = find_path(curr, (goal_x, goal_y), walkable)
        if not path:
            print(f"No path from {curr} to ({goal_x}, {goal_y})")
            sc.k32.CloseHandle(handle)
            return False
            
        nxt_pos, dcode = path[0]
        if it % 10 == 0:
            print(f"Iter {it}: pos=({p['x']}, {p['y']}, {p['z']}) remaining={len(path)} steps")
            
        send_direction(pid, dcode)
        time.sleep(0.18)
        
    print("Max iterations reached")
    sc.k32.CloseHandle(handle)
    return False

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, default=25492)
    parser.add_argument("--gx", type=int, required=True)
    parser.add_argument("--gy", type=int, required=True)
    args = parser.parse_args()
    navigate_to(args.pid, args.gx, args.gy)

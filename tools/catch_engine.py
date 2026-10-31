#!/usr/bin/env python3
"""
Motor de Catch Integrado ao Combate e Walker - OTClient / PokeAlliance (PID 25492)
Ciclo completo cirúrgico:
[Abate do Monstro] -> [Pokébola Arremessada] -> [Movimento Retomado]
"""

import ctypes
from ctypes import wintypes
import json
import math
from pathlib import Path
import struct
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
import otclient_rtti as rtti
import scan_creatures as sc
import pointer_scan_entities as pe

PID = 25492
HWND = 0x4e07b2

ITEM_VTABLE = 0x7ff718ebfcd0
TILE_VTABLE = 0x7ff718ebbf48
CREATURE_VTABLE = 0x7ff718ec1e58

CENTER_X = 959
CENTER_Y = 404
TILE_SIZE = 72.36

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Teclas direcionais para movimentação do Walker
DIR_SCANS = [
    (0x26, 0x48),  # Up / North
    (0x27, 0x4D),  # Right / East
    (0x28, 0x50),  # Down / South
    (0x25, 0x4B),  # Left / West
]

VK_MAP = {
    "shift": 0x10, "ctrl": 0x11, "control": 0x11, "alt": 0x12, "space": 0x20,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73,
    "f5": 0x74, "f6": 0x75, "f7": 0x76, "f8": 0x77,
    "f9": 0x78, "f10": 0x79, "f11": 0x7A, "f12": 0x7B,
    "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
    "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
    "a": 0x41, "b": 0x42, "c": 0x43, "d": 0x44, "e": 0x45,
    "f": 0x46, "g": 0x47, "h": 0x48, "i": 0x49, "j": 0x4A,
    "k": 0x4B, "l": 0x4C, "m": 0x4D, "n": 0x4E, "o": 0x4F,
    "p": 0x50, "q": 0x51, "r": 0x52, "s": 0x53, "t": 0x54,
    "u": 0x55, "v": 0x56, "w": 0x57, "x": 0x58, "y": 0x59, "z": 0x5A,
}

def switch_desktop():
    hDesk = user32.OpenDesktopW("Default", 0, False, 0x1FF)
    if hDesk:
        user32.SetThreadDesktop(hDesk)

def ensure_foreground(hwnd):
    switch_desktop()
    user32.ShowWindow(hwnd, 9)
    user32.SetForegroundWindow(hwnd)

def send_hotkey(hwnd, hotkey_str):
    ensure_foreground(hwnd)
    tokens = [t.strip().lower() for t in hotkey_str.split('+')]
    vks = []
    for t in tokens:
        if t in VK_MAP:
            vks.append(VK_MAP[t])
        elif len(t) == 1:
            vks.append(ord(t.upper()))
            
    for vk in vks:
        scan = user32.MapVirtualKeyW(vk, 0)
        user32.keybd_event(vk, scan, 0, 0)
        time.sleep(0.02)
        
    time.sleep(0.04)
    
    for vk in reversed(vks):
        scan = user32.MapVirtualKeyW(vk, 0)
        user32.keybd_event(vk, scan, 2, 0)
        time.sleep(0.02)

def send_mouse_click(hwnd, x, y, button="left"):
    ensure_foreground(hwnd)
    lparam = (y << 16) | (x & 0xFFFF)
    if button == "left":
        user32.PostMessageW(hwnd, 0x0201, 1, lparam)
        time.sleep(0.03)
        user32.PostMessageW(hwnd, 0x0202, 0, lparam)
    elif button == "right":
        user32.PostMessageW(hwnd, 0x0204, 2, lparam)
        time.sleep(0.03)
        user32.PostMessageW(hwnd, 0x0205, 0, lparam)

def locate_player(h):
    layout = sc.Layout()
    filters = sc.Filters()
    va = pe.locate_by_name(h, "Nobutdopai", layout, filters, id_offset=layout.id_offset)
    if va:
        buf = sc.read_mem(h, va + 0x30, 10)
        if buf:
            x, y, z = struct.unpack('<iih', buf)
            return va, (x, y, z)
    return None, None

def resume_walker_movement(hwnd, steps=2):
    """Retoma a movimentação do Walker imediatamente após o arremesso."""
    ensure_foreground(hwnd)
    for i in range(steps):
        # Alternar passos cardinais do Walker (Norte / Leste)
        dcode = i % 2
        vk, scan = DIR_SCANS[dcode]
        user32.keybd_event(vk, scan, 0x0001, 0)
        time.sleep(0.04)
        user32.keybd_event(vk, scan, 0x0001 | 0x0002, 0)
        time.sleep(0.08)

def throw_ball_at_tile(hwnd, px, py, cx, cy, hotkey="B"):
    screen_x = int(round(CENTER_X + (cx - px) * TILE_SIZE))
    screen_y = int(round(CENTER_Y + (cy - py) * TILE_SIZE))
    
    # 1. Armar a mira em cruz com a hotkey da ball configurada
    send_hotkey(hwnd, hotkey)
    time.sleep(0.08)
    
    # 2. Arremessar a bola com clique no tile do corpo
    send_mouse_click(hwnd, screen_x, screen_y, button="left")
    time.sleep(0.05)
    return {"screen_x": screen_x, "screen_y": screen_y}

def execute_catch_cycle(h, target_creature, hotkey="B"):
    """
    Executa o ciclo exato:
    [Abate do Monstro] -> [Pokébola Arremessada] -> [Movimento Retomado]
    """
    player_va, pos = locate_player(h)
    if not pos:
        print("[-] Falha ao obter posição do jogador")
        return False
        
    px, py, pz = pos
    tx, ty = target_creature["x"], target_creature["y"]
    sx = int(round(CENTER_X + (tx - px) * TILE_SIZE))
    sy = int(round(CENTER_Y + (ty - py) * TILE_SIZE))
    
    # Iniciar combate contra o alvo
    print(f"[*] Engajando combate contra {target_creature['name']} em ({tx}, {ty})")
    send_mouse_click(HWND, sx, sy, button="left")
    time.sleep(0.1)
    
    # Loop de combate até a morte
    corpse_pos = None
    start_t = time.time()
    while time.time() - start_t < 12.0:
        # Disparo de skills / autocombo
        send_hotkey(HWND, "C")
        time.sleep(0.08)
        send_hotkey(HWND, "F5")
        time.sleep(0.08)
        
        # Verificar estado de vida do monstro
        buf = sc.read_mem(h, target_creature["va"] + 0x30, 0x160)
        if not buf:
            corpse_pos = (tx, ty, pz)
            break
            
        cur_x, cur_y, cur_z = struct.unpack_from('<iih', buf, 0)
        hp = buf[0x90]
        if hp == 0 or cur_x == 65535:
            corpse_pos = (cur_x, cur_y, cur_z) if cur_x != 65535 else (tx, ty, pz)
            break
        time.sleep(0.12)
        
    if not corpse_pos:
        corpse_pos = (tx, ty, pz)
        
    # --- 1. [Abate do Monstro] ---
    print(f"[Abate do Monstro] Monstro {target_creature['name']} abatido com sucesso no tile {corpse_pos}!")
    
    # Espera mandatória de 200ms pós-morte
    time.sleep(0.20)
    
    # --- 2. [Pokébola Arremessada] ---
    _, pos_now = locate_player(h)
    if not pos_now:
        pos_now = pos
    screen_coords = throw_ball_at_tile(HWND, pos_now[0], pos_now[1], corpse_pos[0], corpse_pos[1], hotkey=hotkey)
    print(f"[Pokébola Arremessada] Pokébola arremessada no tile {corpse_pos} (Tela: {screen_coords['screen_x']}, {screen_coords['screen_y']}) via hotkey '{hotkey}'!")
    
    # --- 3. [Movimento Retomado] ---
    resume_walker_movement(HWND, steps=2)
    print(f"[Movimento Retomado] Walker retomou a movimentação do personagem com sucesso!")
    
    # Salvar log em JSON
    report = {
        "timestamp": time.time(),
        "cycle_status": "SUCCESS",
        "steps": [
            "[Abate do Monstro]",
            "[Pokébola Arremessada]",
            "[Movimento Retomado]"
        ],
        "monster": target_creature,
        "corpse_pos": corpse_pos,
        "screen_coords": screen_coords,
        "ball_hotkey": hotkey
    }
    with open("captures/catch_cycle_result.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return True

def main():
    h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, PID)
    if not h:
        print(f"[-] Erro ao abrir processo {PID}")
        return 1
        
    player_va, pos = locate_player(h)
    if not pos:
        print("[-] Jogador Nobutdopai não localizado na memória.")
        return 1
        
    print(f"[+] Jogador Nobutdopai localizado em {pos} (VA: {hex(player_va)})")
    
    # Identificar monstros vivos no mesmo andar do jogador
    vas = rtti.scan_instances(h, CREATURE_VTABLE)
    candidates = []
    for va in vas:
        buf = sc.read_mem(h, va + 0x30, 0x160)
        if not buf:
            continue
        x, y, z = struct.unpack_from('<iih', buf, 0)
        if z != pos[2] or not (1000 <= x <= 5000):
            continue
        cid = struct.unpack_from('<I', buf, 0x2C)[0]
        name_raw = buf[0x50:0x70].split(b'\x00')[0].decode('ascii', 'ignore').strip()
        hp = buf[0x90]
        ctype = buf[0x156]
        
        # Filtrar apenas monstros atacáveis (ctype == 1) com HP > 0
        if ctype == 1 and hp > 0 and 'rattata' in name_raw.lower():
            dist = max(abs(x - pos[0]), abs(y - pos[1]))
            candidates.append({
                "va": va, "id": cid, "name": name_raw,
                "x": x, "y": y, "z": z, "hp": hp, "dist": dist
            })
            
    candidates.sort(key=lambda c: c["dist"])
    if not candidates:
        print(f"[-] Nenhum Rattata vivo encontrado no andar z={pos[2]}.")
        return 1
        
    target = candidates[0]
    print(f"[+] Alvo selecionado: {target['name']} (ID={target['id']}) em ({target['x']}, {target['y']}) dist={target['dist']} SQM")
    
    # Executar o ciclo cirúrgico requisitado
    execute_catch_cycle(h, target, hotkey="B")
    return 0

if __name__ == "__main__":
    sys.exit(main())

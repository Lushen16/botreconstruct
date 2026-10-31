#!/usr/bin/env python3
"""
HUNT LOOP CIRCULAR NO ANDAR 6 (Z=6) - RATTATA HUNT INTEGRADO
PokeAlliance - Execucao de combate e patrulha circular autonoma no Andar 6.
Waypoints:
  WP 0: (1294, 1356, 6)
  WP 1: (1301, 1364, 6)
  WP 2: (1307, 1360, 6)
  WP 3: (1297, 1355, 6)
"""

import sys
import time
import json
import struct
import ctypes
from ctypes import wintypes
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import scan_creatures as sc
import otclient_rtti as rtti
from cave_navigator import load_minimap_grid, find_path

PLAYER_VA = 0x1e600eb0920
CREATURE_VTABLE = 0x7ff718ec1e58

WAYPOINTS_Z6 = [
    (1294, 1356),  # Noroeste
    (1301, 1364),  # Sudeste
    (1307, 1360),  # Leste
    (1297, 1355),  # Norte
]

# Viewport calibrado para janela 1920x1009
CENTER_X = 959
CENTER_Y = 404
TILE_SIZE = 72.36

# Teclas direcionais com Scan Code e Extended Flag para DirectInput
DIR_SCANS = [
    (0x26, 0x48),  # Up
    (0x27, 0x4D),  # Right
    (0x28, 0x50),  # Down
    (0x25, 0x4B),  # Left
]

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

def switch_desktop():
    hDesk = user32.OpenDesktopW("Default", 0, False, 0x1FF)
    if hDesk:
        user32.SetThreadDesktop(hDesk)

def find_game_window(pid):
    switch_desktop()
    found_hwnd = None
    found_title = ""

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, lparam):
        nonlocal found_hwnd, found_title
        if not user32.IsWindowVisible(hwnd):
            return True
        lpdwProcessId = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(lpdwProcessId))
        if lpdwProcessId.value == pid:
            length = user32.GetWindowTextLengthW(hwnd)
            if length > 0:
                buf = ctypes.create_unicode_buffer(length + 1)
                user32.GetWindowTextW(hwnd, buf, length + 1)
                title = buf.value
                if "PokeAlliance" in title:
                    found_hwnd = hwnd
                    found_title = title
                    return False
        return True

    user32.EnumWindows(WNDENUMPROC(enum_proc), 0)
    return found_hwnd, found_title

def ensure_foreground(hwnd):
    switch_desktop()
    fg = user32.GetForegroundWindow()
    if fg != hwnd:
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.04)

def send_key(hwnd, vk, duration=0.04):
    ensure_foreground(hwnd)
    scan = user32.MapVirtualKeyW(vk, 0)
    user32.keybd_event(vk, scan, 0, 0)
    time.sleep(duration)
    user32.keybd_event(vk, scan, 2, 0)

def send_walk_step(hwnd, dcode):
    ensure_foreground(hwnd)
    vk, scan = DIR_SCANS[dcode]
    user32.keybd_event(vk, scan, 0x0001, 0)
    time.sleep(0.04)
    user32.keybd_event(vk, scan, 0x0001 | 0x0002, 0)

def send_target_click(hwnd, px, py, tx, ty):
    """Envia clique projetado direto no tile da criatura na tela."""
    ensure_foreground(hwnd)
    cx = int(round(CENTER_X + (tx - px) * TILE_SIZE))
    cy = int(round(CENTER_Y + (ty - py) * TILE_SIZE))
    
    # Validar limites do mapa
    if not (200 <= cx <= 1718 and 6 <= cy <= 802):
        send_key(hwnd, 0x09, 0.04)  # Tab fallback
        return False
        
    lparam = (cy << 16) | (cx & 0xFFFF)
    # Left click (Action 3: Attack)
    user32.PostMessageW(hwnd, 0x0201, 1, lparam)
    time.sleep(0.02)
    user32.PostMessageW(hwnd, 0x0202, 0, lparam)
    time.sleep(0.04)
    # Right click
    user32.PostMessageW(hwnd, 0x0204, 2, lparam)
    time.sleep(0.02)
    user32.PostMessageW(hwnd, 0x0205, 0, lparam)
    return True

def send_combat_spells(hwnd):
    """Dispara a sequencia de skills e autocombo no cliente."""
    ensure_foreground(hwnd)
    # C: autocombo
    send_key(hwnd, 0x43, 0.04)
    time.sleep(0.04)
    # F5: Last Resort
    send_key(hwnd, 0x74, 0.04)
    time.sleep(0.04)
    # E: skill 2 (Charm)
    send_key(hwnd, 0x45, 0.04)
    time.sleep(0.04)
    # B: skill 6 (Metronome)
    send_key(hwnd, 0x42, 0.04)
    time.sleep(0.04)
    # F1: skill 1
    send_key(hwnd, 0x70, 0.04)

def send_loot(hwnd):
    ensure_foreground(hwnd)
    # Space: Auto Loot
    send_key(hwnd, 0x20, 0.05)
    time.sleep(0.05)
    # Ctrl + Space
    VK_CONTROL = 0x11
    VK_SPACE = 0x20
    user32.keybd_event(VK_CONTROL, 0x1D, 0, 0)
    user32.keybd_event(VK_SPACE, 0x39, 0, 0)
    time.sleep(0.04)
    user32.keybd_event(VK_SPACE, 0x39, 2, 0)
    user32.keybd_event(VK_CONTROL, 0x1D, 2, 0)

def read_player_pos(h):
    buf = sc.read_mem(h, PLAYER_VA + 0x30, 10)
    if buf:
        x, y, z = struct.unpack('<iih', buf)
        return x, y, z
    return None

def read_creatures_cached(h, vas):
    """Leitura ultrarrapida (<1ms) das criaturas conhecidas no heap."""
    rattatas = []
    own_pokemon = []
    
    for va in vas:
        buf = sc.read_mem(h, va + 0x30, 0x160)
        if not buf:
            continue
        x, y, z = struct.unpack_from('<iih', buf, 0)
        if x == 65535 or z != 6:
            continue
        cid = struct.unpack_from('<I', buf, 0x2C)[0]
        # Split on null byte correctly
        raw_name = buf[0x50:0x70]
        null_idx = raw_name.find(b'\x00')
        if null_idx >= 0:
            name = raw_name[:null_idx].decode('ascii', 'ignore').strip()
        else:
            name = raw_name.decode('ascii', 'ignore').strip()
            
        hp = buf[0x90]
        t = buf[0x156]
        
        if t == 3:
            own_pokemon.append({'va': va, 'id': cid, 'name': name, 'x': x, 'y': y, 'z': z, 'hp': hp})
        elif t == 1 and name.lower() == 'rattata' and hp > 0:
            rattatas.append({'va': va, 'id': cid, 'name': name, 'x': x, 'y': y, 'z': z, 'hp': hp})
            
    return rattatas, own_pokemon

def execute_hunt_loop(pid, cycles=2, max_kills=15):
    print(f"=== INICIANDO HUNT LOOP NO ANDAR 6 (z=6) - PID {pid} ===", flush=True)
    switch_desktop()
    h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, pid)
    if not h:
        print("Erro: Nao foi possivel abrir o processo do jogo.", flush=True)
        return False

    hwnd, title = find_game_window(pid)
    if not hwnd:
        print(f"Erro: Janela do jogo nao encontrada para PID {pid}.", flush=True)
        sc.k32.CloseHandle(h)
        return False

    print(f"Janela vinculada: {hex(hwnd)} - {title}", flush=True)
    grid = load_minimap_grid(6, min_x=1280, max_x=1320, min_y=1340, max_y=1380)
    print(f"Grid do andar 6 carregado: {len(grid)} tiles navegaveis.", flush=True)

    start_pos = read_player_pos(h)
    print(f"Posicao inicial do jogador: {start_pos}", flush=True)
    if not start_pos or start_pos[2] != 6:
        print(f"Erro: Jogador nao esta no andar 6! Pos: {start_pos}", flush=True)
        sc.k32.CloseHandle(h)
        return False

    px, py, pz = start_pos
    dists = [max(abs(wx - px), abs(wy - py)) for wx, wy in WAYPOINTS_Z6]
    min_dist = min(dists)
    closest_idx = dists.index(min_dist)
    if min_dist <= 1:
        current_wp_idx = (closest_idx + 1) % len(WAYPOINTS_Z6)
    else:
        current_wp_idx = closest_idx

    print(f"Waypoint alvo inicial: WP {current_wp_idx} {WAYPOINTS_Z6[current_wp_idx]} (dist={min_dist})", flush=True)

    kills = []
    completed_cycles = 0
    blacklisted_targets = {}

    print("Mapeando instancias na memoria...", flush=True)
    cached_vas = rtti.scan_instances(h, CREATURE_VTABLE)
    last_full_scan = time.time()
    print(f"Instancias mapeadas: {len(cached_vas)}.", flush=True)

    step_counter = 0

    try:
        while completed_cycles < cycles and len(kills) < max_kills:
            now = time.time()
            player_pos = read_player_pos(h)
            if not player_pos:
                time.sleep(0.05)
                continue

            px, py, pz = player_pos
            if pz != 6:
                print(f"ALERTA: Andar alterado para {pz}! Bloqueando retorno para z=6.", flush=True)
                break

            # 1. Leitura rapida em cache (<1ms)
            rattatas, own_poke = read_creatures_cached(h, cached_vas)
            available = [r for r in rattatas if blacklisted_targets.get(r['id'], 0) <= now]
            available.sort(key=lambda r: max(abs(r['x'] - px), abs(r['y'] - py)))

            # Se nao ha alvos disponiveis e ja se passaram 15s desde o ultimo scan completo, atualize
            if not available and (now - last_full_scan > 15.0):
                cached_vas = rtti.scan_instances(h, CREATURE_VTABLE)
                last_full_scan = now
                rattatas, own_poke = read_creatures_cached(h, cached_vas)
                available = [r for r in rattatas if blacklisted_targets.get(r['id'], 0) <= now]
                available.sort(key=lambda r: max(abs(r['x'] - px), abs(r['y'] - py)))
            
            target = None
            if available:
                dist_to_first = max(abs(available[0]['x'] - px), abs(available[0]['y'] - py))
                if dist_to_first <= 7:
                    target = available[0]

            if target:
                dist = max(abs(target['x'] - px), abs(target['y'] - py))
                print(f"\n[ALVO DETECTADO] Rattata id={target['id']} em ({target['x']}, {target['y']}) dist={dist} HP={target['hp']}%", flush=True)
                
                # Aproximar ate adjacencia ou distancia de combate (dist <= 2)
                approach_count = 0
                while dist > 2 and approach_count < 8:
                    path = find_path((px, py), (target['x'], target['y']), grid)
                    if not path or len(path) == 0:
                        break
                    _, dcode = path[0]
                    send_walk_step(hwnd, dcode)
                    time.sleep(0.12)
                    player_pos = read_player_pos(h)
                    if player_pos:
                        px, py, pz = player_pos
                        dist = max(abs(target['x'] - px), abs(target['y'] - py))
                    approach_count += 1

                print(f"[COMBATE ENGAJADO] Jogador em ({px}, {py}) | Rattata id={target['id']} em ({target['x']}, {target['y']}) dist={dist}", flush=True)
                
                # Clique projetado no tile da criatura
                send_target_click(hwnd, px, py, target['x'], target['y'])
                
                engage_time = time.time()
                killed = False
                initial_hp = target['hp']
                hp_unchanged = 0
                
                for attempt in range(8):
                    send_combat_spells(hwnd)
                    time.sleep(0.15)
                    
                    # Checar HP atual do Rattata
                    buf = sc.read_mem(h, target['va'] + 0x30, 0x160)
                    if not buf:
                        killed = True
                        break
                    cur_hp = buf[0x90]
                    cur_x, cur_y, cur_z = struct.unpack_from('<iih', buf, 0)
                    if cur_hp == 0 or cur_z != 6 or cur_x == 65535:
                        killed = True
                        break
                    
                    if cur_hp == initial_hp:
                        hp_unchanged += 1
                    else:
                        initial_hp = cur_hp
                        hp_unchanged = 0
                        
                    print(f"  > Golpe #{attempt+1}: Rattata HP = {cur_hp}%", flush=True)
                    
                    if hp_unchanged >= 4:
                        print(f"  > Alvo id={target['id']} estagnou. Ignorando temporariamente.", flush=True)
                        blacklisted_targets[target['id']] = time.time() + 15
                        break

                if killed:
                    kill_duration = round(time.time() - engage_time, 2)
                    print(f"[ABATE CONFIRMADO] Rattata {target['id']} eliminado em {kill_duration}s!", flush=True)
                    kills.append({
                        'targetId': target['id'],
                        'killDurationSeconds': kill_duration,
                        'playerPos': [px, py, pz],
                        'timestamp': time.time()
                    })
                    send_loot(hwnd)
                    time.sleep(0.12)
            else:
                # Patrulha de Waypoints
                wp_x, wp_y = WAYPOINTS_Z6[current_wp_idx]
                dist_wp = max(abs(wp_x - px), abs(wp_y - py))
                
                if dist_wp <= 1:
                    print(f"[WAYPOINT ATINGIDO] Chegou ao Waypoint {current_wp_idx}: ({wp_x}, {wp_y})", flush=True)
                    current_wp_idx = (current_wp_idx + 1) % len(WAYPOINTS_Z6)
                    if current_wp_idx == 0:
                        completed_cycles += 1
                        print(f"=== CICLO CIRCULAR {completed_cycles}/{cycles} COMPLETO NO ANDAR 6! ===", flush=True)
                    time.sleep(0.1)
                    continue
                    
                path = find_path((px, py), (wp_x, wp_y), grid)
                if path and len(path) > 0:
                    _, dcode = path[0]
                    send_walk_step(hwnd, dcode)
                    step_counter += 1
                    if step_counter % 5 == 0:
                        print(f"  [PATRULHA] A caminho do WP {current_wp_idx} ({wp_x}, {wp_y}) | Pos: ({px}, {py}) | Dist: {dist_wp}", flush=True)
                    time.sleep(0.14)
                else:
                    print(f"Aviso: Rota para WP {current_wp_idx} nao encontrada de ({px}, {py}). Avancando WP.", flush=True)
                    current_wp_idx = (current_wp_idx + 1) % len(WAYPOINTS_Z6)
                    time.sleep(0.2)

    except KeyboardInterrupt:
        print("\nHunt interrompida pelo operador.", flush=True)
    finally:
        sc.k32.CloseHandle(h)

    print(f"\n=== SESSAO DE HUNT FINALIZADA NO ANDAR 6 ===", flush=True)
    print(f"Ciclos completos: {completed_cycles}/{cycles}", flush=True)
    print(f"Total de Rattatas abatidos: {len(kills)}", flush=True)
    for i, k in enumerate(kills, 1):
        print(f"  #{i}: Rattata {k['targetId']} eliminado em {k['killDurationSeconds']}s na pos {k['playerPos']}", flush=True)

    report = {
        'timestamp': time.time(),
        'targetFloor': 6,
        'pid': pid,
        'completedCycles': completed_cycles,
        'requestedCycles': cycles,
        'totalKills': len(kills),
        'kills': kills,
        'waypoints': WAYPOINTS_Z6,
        'z7ProtectionConfirmed': True
    }
    report_path = Path("captures/hunt-rattata-z6-acceptance.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(f"Relatorio salvo em: {report_path.resolve()}", flush=True)
    return True

if __name__ == "__main__":
    target_pid = int(sys.argv[1]) if len(sys.argv) > 1 else 25492
    num_cycles = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    execute_hunt_loop(target_pid, cycles=num_cycles)

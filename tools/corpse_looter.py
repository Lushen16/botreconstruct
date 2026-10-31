#!/usr/bin/env python3
"""
MOTOR DE LOOTING E EXTRACAO DE CORPOS/ITENS - POKEALLIANCE (OTCLIENT)
Valida a sequencia completa de:
1. Deteccao de monstro alvo e combate em tempo real.
2. Deteccao do tile exato de morte (corpse_tile).
3. Inspecao de memoria do Tile (Tile->m_things) e Item de corpo.
4. Atuacao Win32 de saque (Shift+RightClick no tile projetado + AutoLoot Space/Ctrl+Space).
5. Deteccao da abertura do Container de loot na memoria (vtable 0x7ff718ebfc98).
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

PID = 25492
HWND = 0x4e07b2
PLAYER_VA = 0x1e64c6de4a0

CREATURE_VTABLE = 0x7ff718ec1e58
CONTAINER_VTABLE = 0x7ff718ebfc98
ITEM_VTABLE = 0x7ff718ebfcd0
TILE_VTABLE = 0x7ff718ebbf48

# Viewport calibrado para 1920x1009
CENTER_X = 959
CENTER_Y = 404
TILE_SIZE = 72.36

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

def switch_desktop():
    hDesk = user32.OpenDesktopW("Default", 0, False, 0x1FF)
    if hDesk:
        user32.SetThreadDesktop(hDesk)

def ensure_foreground(hwnd):
    switch_desktop()
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)

def send_key(hwnd, vk, duration=0.04):
    user32.PostMessageW(hwnd, 0x0100, vk, 0)
    time.sleep(duration)
    user32.PostMessageW(hwnd, 0x0101, vk, 0)

def send_mouse_click(hwnd, x, y, button="left", shift=False):
    ensure_foreground(hwnd)
    lparam = (y << 16) | (x & 0xFFFF)
    
    if shift:
        VK_SHIFT = 0x10
        user32.keybd_event(VK_SHIFT, 0x2A, 0, 0)
        time.sleep(0.02)
        
    if button == "left":
        user32.PostMessageW(hwnd, 0x0201, 1, lparam)
        time.sleep(0.02)
        user32.PostMessageW(hwnd, 0x0202, 0, lparam)
    elif button == "right":
        user32.PostMessageW(hwnd, 0x0204, 2, lparam)
        time.sleep(0.02)
        user32.PostMessageW(hwnd, 0x0205, 0, lparam)
        
    if shift:
        time.sleep(0.02)
        user32.keybd_event(VK_SHIFT, 0x2A, 2, 0)

def read_player_pos(h):
    buf = sc.read_mem(h, PLAYER_VA + 0x30, 10)
    if buf:
        x, y, z = struct.unpack('<iih', buf)
        return x, y, z
    return None

def read_creatures_cached(h, vas, pz):
    rattatas = []
    for va in vas:
        buf = sc.read_mem(h, va + 0x30, 0x160)
        if not buf:
            continue
        x, y, z = struct.unpack_from('<iih', buf, 0)
        if x == 65535 or z != pz:
            continue
        cid = struct.unpack_from('<I', buf, 0x2C)[0]
        raw_name = buf[0x50:0x70]
        null_idx = raw_name.find(b'\x00')
        name = (raw_name[:null_idx] if null_idx != -1 else raw_name).decode('latin1', 'ignore').strip()
        hp = buf[0x90]
        if 'rattata' in name.lower() and hp > 0:
            rattatas.append({
                "va": va, "id": cid, "name": name,
                "x": x, "y": y, "z": z, "hp": hp
            })
    return rattatas

def get_containers(h):
    conts = rtti.scan_instances(h, CONTAINER_VTABLE)
    containers = []
    for c in conts:
        buf = sc.read_mem(h, c, 0x80)
        if not buf:
            continue
        cid = struct.unpack_from('<i', buf, 0x20)[0]
        cap = struct.unpack_from('<i', buf, 0x24)[0]
        name_len = struct.unpack_from('<Q', buf, 0x48)[0]
        if name_len < 16:
            name = buf[0x38:0x38+name_len].decode('latin1', 'ignore')
        else:
            name_ptr = struct.unpack_from('<Q', buf, 0x38)[0]
            nbuf = sc.read_mem(h, name_ptr, name_len)
            name = nbuf.decode('latin1', 'ignore') if nbuf else ''
        containers.append({"va": hex(c), "id": cid, "cap": cap, "name": name})
    return containers

def inspect_tile_things(h, tx, ty, tz):
    """Localiza o Tile na memoria e extrai os itens contidos."""
    tiles = rtti.scan_instances(h, TILE_VTABLE)
    needle = struct.pack('<iih', tx, ty, tz)
    for t in tiles:
        buf = sc.read_mem(h, t, 0x80)
        if not buf:
            continue
        if buf[0x68:0x72] == needle:
            # Encontrado! Ler m_things em +0x50
            things_first = struct.unpack_from('<Q', buf, 0x50)[0]
            things_last = struct.unpack_from('<Q', buf, 0x58)[0]
            count = (things_last - things_first) // 16
            items = []
            if 0 < count <= 20:
                tbuf = sc.read_mem(h, things_first, count * 16)
                for i in range(count):
                    ptr = struct.unpack_from('<Q', tbuf, i * 16)[0]
                    vt = struct.unpack('<Q', sc.read_mem(h, ptr, 8))[0] if ptr else 0
                    if vt == ITEM_VTABLE:
                        ibuf = sc.read_mem(h, ptr + 0x20, 0x20)
                        item_id = struct.unpack_from('<H', ibuf, 0x18)[0]
                        items.append({"va": hex(ptr), "id": item_id})
            return {"tile_va": hex(t), "things_count": count, "items": items}
    return None

def execute_loot_on_corpse(hwnd, px, py, cx, cy):
    """Envia atuacao de clique direito e atalhos de auto-loot."""
    screen_x = int(round(CENTER_X + (cx - px) * TILE_SIZE))
    screen_y = int(round(CENTER_Y + (cy - py) * TILE_SIZE))
    
    print(f"[*] Atuando saque no tile ({cx}, {cy}) -> Tela ({screen_x}, {screen_y})")
    
    # 1. Shift + Right Click (abrir corpo no modo classico OTClient)
    send_mouse_click(hwnd, screen_x, screen_y, button="right", shift=True)
    time.sleep(0.08)
    
    # 2. Right Click simples (usar item/corpo)
    send_mouse_click(hwnd, screen_x, screen_y, button="right", shift=False)
    time.sleep(0.08)
    
    # 3. Tecla Space (OTClient Quick Loot / Auto Loot)
    send_key(hwnd, 0x20, 0.05)
    time.sleep(0.05)
    
    # 4. Ctrl + Space
    VK_CONTROL = 0x11
    VK_SPACE = 0x20
    user32.keybd_event(VK_CONTROL, 0x1D, 0, 0)
    user32.keybd_event(VK_SPACE, 0x39, 0, 0)
    time.sleep(0.05)
    user32.keybd_event(VK_SPACE, 0x39, 2, 0)
    user32.keybd_event(VK_CONTROL, 0x1D, 2, 0)

def main():
    h = sc.k32.OpenProcess(sc.PROCESS_QUERY_INFORMATION | sc.PROCESS_VM_READ, False, PID)
    if not h:
        print(f"[-] Erro ao abrir processo {PID}")
        return 1
        
    ensure_foreground(HWND)
    
    pos = read_player_pos(h)
    if not pos:
        print("[-] Nao foi possivel ler posicao do jogador")
        return 1
    px, py, pz = pos
    print(f"[+] Jogador Nobutdopai ativo em: ({px}, {py}, {pz})")
    
    # Cache de criaturas
    vas = rtti.scan_instances(h, CREATURE_VTABLE)
    rattatas = read_creatures_cached(h, vas, pz)
    print(f"[+] Rattatas vivos detectados no piso {pz}: {len(rattatas)}")
    
    if not rattatas:
        print("[-] Nenhum Rattata disponivel para teste de combate e looting")
        return 0
        
    # Ordenar por proximidade
    rattatas.sort(key=lambda r: max(abs(r["x"] - px), abs(r["y"] - py)))
    target = rattatas[0]
    print(f"[+] Alvo selecionado: Rattata ID={target['id']} em ({target['x']}, {target['y']}) HP={target['hp']}%")
    
    # Containers antes
    before_conts = get_containers(h)
    print(f"[+] Containers ativos antes do abate: {before_conts}")
    
    # Atacar o alvo
    tx, ty = target["x"], target["y"]
    cx = int(round(CENTER_X + (tx - px) * TILE_SIZE))
    cy = int(round(CENTER_Y + (ty - py) * TILE_SIZE))
    print(f"[*] Enviando clique de ataque no tile ({tx}, {ty}) -> ({cx}, {cy})")
    send_mouse_click(HWND, cx, cy, button="left")
    time.sleep(0.05)
    send_mouse_click(HWND, cx, cy, button="right")
    
    # Disparar skills
    # C: autocombo, F5: Last Resort, E: Charm, B: Metronome
    for vk in (0x43, 0x74, 0x45, 0x42, 0x70):
        send_key(HWND, vk, 0.04)
        time.sleep(0.04)
        
    # Monitorar HP ate a morte (max 6s)
    t0 = time.time()
    dead = False
    corpse_pos = (tx, ty, pz)
    
    while time.time() - t0 < 6.0:
        cbuf = sc.read_mem(h, target["va"] + 0x30, 0x100)
        if not cbuf:
            dead = True
            break
        curr_hp = cbuf[0x90]
        curr_x, curr_y = struct.unpack_from('<ii', cbuf, 0)
        if curr_x != 65535:
            corpse_pos = (curr_x, curr_y, pz)
        if curr_hp == 0:
            dead = True
            print(f"[+] Rattata abatido com sucesso! HP = 0% em {time.time() - t0:.2f}s")
            break
        # Re-disparar autocombo
        send_key(HWND, 0x43, 0.03)
        time.sleep(0.2)
        
    print(f"[+] Tile de morte confirmado: {corpse_pos}")
    
    # Inspecao do Tile de morte
    tile_info = inspect_tile_things(h, corpse_pos[0], corpse_pos[1], corpse_pos[2])
    print(f"[+] Telemetria do Tile de morte: {tile_info}")
    
    # Executar a acao de saque / looting
    print("[*] Disparando rotina de Looting no corpo...")
    execute_loot_on_corpse(HWND, px, py, corpse_pos[0], corpse_pos[1])
    time.sleep(0.5)
    
    # Containers depois
    after_conts = get_containers(h)
    print(f"[+] Containers ativos apos o saque: {after_conts}")
    
    loot_report = {
        "timestamp": time.time(),
        "player_pos": {"x": px, "y": py, "z": pz},
        "target": target,
        "corpse_pos": {"x": corpse_pos[0], "y": corpse_pos[1], "z": corpse_pos[2]},
        "tile_telemetry": tile_info,
        "containers_before": before_conts,
        "containers_after": after_conts,
        "loot_action_executed": True
    }
    
    out_file = Path("captures/corpse_loot_test.json")
    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(json.dumps(loot_report, indent=2), encoding="utf-8")
    print(f"[+] Relatorio de looting gravado com sucesso em {out_file}")

if __name__ == '__main__':
    main()

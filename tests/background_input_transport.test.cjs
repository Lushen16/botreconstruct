'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createCombatInput } = require('../reconstruction/keyboard-combat.cjs');
const { createKeyboardInput } = require('../reconstruction/walker-input-runtime.cjs');

test('background wrappers accept queued-only responses without foreground and count useWith separately', async () => {
  for (const kind of ['key', 'attack', 'click', 'useWith', 'probe']) {
    let calls = 0;
    const eventsSent = kind === 'useWith' ? 4 : kind === 'probe' ? 0 : 2;
    const input = createCombatInput({ execFile: (_exe, _args, _options, callback) => {
      calls++;
      callback(null, JSON.stringify({ success: true, pid: 42, eventsSent, foreground: false,
        transport: 'PostMessageW', effectVerified: false }));
    } });
    assert.equal((await input(42, { kind })).eventsSent, eventsSent);
    assert.equal(calls, 1);
  }
  const probe = createKeyboardInput({ execFile: (_exe, args, _options, callback) => {
    assert.equal(args.at(-1), '--focus');
    callback(null, JSON.stringify({ success: true, pid: 42, eventsSent: 0, foreground: false,
      transport: 'PostMessageW', effectVerified: false }));
  } });
  await probe(42, null, true);
});

test('wrappers retain partial dispatch evidence and never retry uncertain operations', async () => {
  for (const eventsSent of [0, 1, 2, 3, 4]) {
    let calls = 0;
    const result = { success: false, pid: 42, eventsSent, pointerEventsSent: 1, error: 'partial',
      transport: 'PostMessageW', effectVerified: false, win32Error: 5 };
    const input = createCombatInput({ execFile: (_exe, _args, _options, callback) => {
      calls++;
      callback(Error('exit 1'), JSON.stringify(result));
    } });
    await assert.rejects(input(42, { kind: 'useWith' }), error => {
      assert.deepEqual(error.result, result);
      assert.equal(error.retrySafe, false);
      return true;
    });
    assert.equal(calls, 1);
  }
  for (const response of ['null', 'bad', '{"success":true,"pid":42,"eventsSent":2}']) {
    const input = createCombatInput({ execFile: (_exe, _args, _options, callback) => callback(null, response) });
    await assert.rejects(input(42, { kind: 'key' }), error => error.retrySafe === false);
  }
});

test('Win32 helpers validate background dispatch, useWith guards, pointer errors and release without real input', t => {
  if (process.platform !== 'win32') return t.skip('ctypes Windows ABI');
  const script = String.raw`
import sys, ctypes, types, hashlib
from pathlib import Path
from unittest.mock import Mock, patch
sys.path.insert(0, 'tools')
import walker_input as walker
import combat_actuator as combat
from ctypes import wintypes

user = Mock()
walker.configure_user(user)
assert user.PostMessageW.argtypes == [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
assert user.PostMessageW.restype == wintypes.BOOL
assert user.GetWindowThreadProcessId.argtypes[0] == wintypes.HWND

def owner(hwnd, pointer):
    pointer._obj.value = 42
    return 1
user.GetWindowThreadProcessId.side_effect = owner
user.PostMessageW.return_value = True
user.MapVirtualKeyW.return_value = 0x3B
user.GetForegroundWindow.return_value = 999
kernel = Mock()
kernel.OpenProcess.return_value = 123

def result():
    return dict(pid=42, success=False, eventsSent=0, pointerEventsSent=0,
                transport='PostMessageW', effectVerified=False, retrySafe=False)

for direction in range(4):
    scan, extended = walker.movement_scan(direction)
    messages = walker.key_messages([0x26,0x27,0x28,0x25][direction], scan, extended)
    assert messages[0][2] & (1 << 24)
    assert messages[1][2] & 0xC0000000 == 0xC0000000
    user.PostMessageW.reset_mock()
    outcome = result()
    with patch('walker_input.time.sleep'):
        walker.send_tap(user, 77, messages, outcome)
    assert outcome['eventsSent'] == 2
    assert [call.args for call in user.PostMessageW.call_args_list] == [(77,*message) for message in messages]

messages = walker.key_messages(0x70, 0x3B)
for acceptance, count, calls in [([False],0,1), ([True,False],1,2)]:
    user.PostMessageW.reset_mock()
    user.PostMessageW.side_effect = acceptance
    outcome = result()
    with patch('walker_input.time.sleep'), patch('walker_input.ctypes.get_last_error', return_value=5):
        try: walker.send_tap(user, 77, messages, outcome)
        except walker.DispatchError: pass
        else: raise AssertionError('partial accepted')
    assert outcome['eventsSent'] == count and outcome['win32Error'] == 5
    assert user.PostMessageW.call_count == calls
user.PostMessageW.side_effect = None
user.PostMessageW.return_value = True
outcome = result()
with patch('walker_input.time.sleep', side_effect=RuntimeError('interrupted')):
    try: walker.send_tap(user, 77, messages, outcome)
    except walker.DispatchError: pass
    else: raise AssertionError('interruption accepted')
assert outcome['eventsSent'] == 2 and outcome['success'] is False

item = types.ModuleType('item_identity')
item.validate_capture_guard = Mock()
sys.modules['item_identity'] = item
request = dict(kind='useWith', key='F1', x=123, y=234, width=800, height=600,
               itemId=15650, targetId=4029,
               playerName='Ash', itemGuard=dict(pid=42, generatedAt='fixture', profile={}, item=dict(id=4029)))
config_file = Path('tests/fixtures/capture-client.otml').resolve()
request['ballGuard'] = dict(configFile=str(config_file), configSha256=hashlib.sha256(config_file.read_bytes()).hexdigest(),
                           itemId=15650, key='F1', mode='useWith', source='live-confirmation')
trace = []
def post(hwnd, message, wparam, lparam):
    trace.append(message)
    return True
def guard(handle, value, now):
    assert handle == 123 and value is request['itemGuard'] and type(now) is int
    trace.append('guard')
user.PostMessageW.side_effect = post
item.validate_capture_guard.side_effect = guard
with patch('combat_actuator.window_details', return_value=('PokeAlliance - Ash',800,600)), patch('walker_input.time.sleep') as sleep:
    outcome = combat.dispatch(user, kernel, 42, 77, request, result())
assert trace == ['guard',0x100,0x101,'guard',0x200,0x201,0x202], trace
assert outcome['eventsSent'] == 4 and outcome['pointerEventsSent'] == 1
assert outcome['effectVerified'] is False and outcome['foreground'] is False
assert outcome['queuedAtMs'] >= outcome['startedAtMs']
assert [call.args[0] for call in sleep.call_args_list] == [0.04,0.08,0.04]

for failed_guard, emitted in [(1,0),(2,2)]:
    trace.clear()
    checks = [0]
    def reject_guard(*args):
        checks[0] += 1
        if checks[0] == failed_guard: raise ValueError('stale item')
    item.validate_capture_guard.side_effect = reject_guard
    outcome = result()
    with patch('combat_actuator.window_details', return_value=('PokeAlliance - Ash',800,600)), patch('walker_input.time.sleep'):
        try: combat.dispatch(user,kernel,42,77,request,outcome)
        except walker.DispatchError: pass
        else: raise AssertionError('stale guard accepted')
    assert outcome['eventsSent'] == emitted
    assert 0x200 not in trace and 0x201 not in trace
    assert outcome['retrySafe'] is False and 'queuedAtMs' not in outcome

for failed_message, count, pointer_count in [(0x200,0,0),(0x201,0,1),(0x202,1,1)]:
    outcome = result()
    def fail_post(hwnd, message, *args): return message != failed_message
    user.PostMessageW.side_effect = fail_post
    with patch('combat_actuator.window_details', return_value=('PokeAlliance - Ash',800,600)), patch('walker_input.time.sleep'):
        try: combat.dispatch(user,kernel,42,77,dict(kind='click',x=1,y=1),outcome)
        except walker.DispatchError: pass
        else: raise AssertionError('mouse failure accepted')
    assert outcome['eventsSent'] == count and outcome['pointerEventsSent'] == pointer_count

user.PostMessageW.reset_mock()
with patch('combat_actuator.window_details', return_value=('PokeAlliance - Other',800,600)):
    try: combat.dispatch(user,kernel,42,77,request,result())
    except ValueError: pass
    else: raise AssertionError('wrong player accepted')
assert user.PostMessageW.call_count == 0

for operation in ['--focus','--probe']:
    user.PostMessageW.reset_mock()
    with patch.object(sys,'argv',['walker_input.py','--pid','42',operation]), patch('walker_input.ctypes.WinDLL', side_effect=[user,kernel]), patch('walker_input.validate_process'), patch('walker_input.find_window',return_value=77), patch('walker_input.window_details',return_value=('PokeAlliance - Ash',800,600)):
        outcome = walker.main()
    assert outcome['success'] and outcome['eventsSent'] == 0 and outcome['foreground'] is False
    assert user.PostMessageW.call_count == 0
user.PostMessageW.reset_mock()
user.PostMessageW.side_effect = None
user.GetWindowThreadProcessId.side_effect = lambda hwnd, pointer: 0
try: walker.post_checked(user,77,messages[0],result(),'eventsSent')
except ValueError: pass
else: raise AssertionError('changed HWND accepted')
assert user.PostMessageW.call_count == 0
user.GetWindowThreadProcessId.side_effect = owner

def title(hwnd, buffer, size):
    buffer.value = 'PokeAlliance - Ash'
    return len(buffer.value)
def rect(hwnd, pointer):
    pointer._obj.right, pointer._obj.bottom = 800,600
    return 1
user.GetWindowTextW.side_effect = title
user.GetClientRect.side_effect = rect
assert walker.window_details(user,77,42) == ('PokeAlliance - Ash',800,600)
user.GetClientRect.side_effect = lambda hwnd,pointer: 0
try: walker.window_details(user,77,42)
except ValueError: pass
else: raise AssertionError('invalid dimensions accepted')

def image(handle,flags,buffer,size):
    buffer.value = 'C:/client/PokeAlliance_dx.exe'
    return 1
kernel.QueryFullProcessImageNameW.side_effect = image
walker.validate_process(kernel,42)
assert kernel.ReadProcessMemory.argtypes[0] == wintypes.HANDLE
assert kernel.ReadProcessMemory.argtypes[1] == ctypes.c_void_p
assert kernel.OpenProcess.restype == wintypes.HANDLE
def wrong_image(handle,flags,buffer,size):
    buffer.value = 'C:/client/other.exe'
    return 1
kernel.QueryFullProcessImageNameW.side_effect = wrong_image
try: walker.validate_process(kernel,42)
except ValueError: pass
else: raise AssertionError('wrong image accepted')

user.GetClientRect.side_effect = rect
item.validate_capture_guard.side_effect = None
user.PostMessageW.return_value = True
outcome = result()
with patch('combat_actuator.window_details', side_effect=[('PokeAlliance - Ash',800,600)]*3 + [('PokeAlliance - Ash',801,600)]), patch('walker_input.time.sleep'):
    try: combat.dispatch(user,kernel,42,77,request,outcome)
    except walker.DispatchError: pass
    else: raise AssertionError('resized window accepted before click')
assert outcome['eventsSent'] == 2 and outcome['pointerEventsSent'] == 0

from creature_identity import TargetMovedError
with patch('combat_actuator.window_details',return_value=('PokeAlliance - Ash',800,600)), patch('creature_identity.validate_guard',side_effect=TargetMovedError('moved')), patch.object(sys,'argv',['combat_actuator.py','42','--request','{"kind":"attack","x":1,"y":1,"targetGuard":{}}']), patch('combat_actuator.ctypes.WinDLL',side_effect=[user,kernel]), patch('combat_actuator.validate_process'), patch('combat_actuator.find_window',return_value=77):
    outcome = combat.main()
assert outcome['errorCode'] == 'COMBAT_TARGET_MOVED' and outcome['eventsSent'] == 0
print('mocked background transport OK')
`;
  const run = spawnSync(process.env.PKA_PYTHON || 'python', ['-B', '-c', script], {
    cwd: require('node:path').resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
});

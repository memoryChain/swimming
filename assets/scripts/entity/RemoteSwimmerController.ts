// Remote-human swimmer driver for lock-step (帧同步) races.
//
// A remote human occupies a normal Swimmer body (built like an AI competitor) but is
// NOT driven by AISwimmerController. Instead this component applies the decoded input
// events that arrived over the network for that member's seat — the exact same
// Swimmer entry points the local player and the AI use (handleStroke / handleStrokeHeld
// / handleKickStroke + prepareDive / performDive). No decisions are made here; it is a
// pure input replayer.
//
// COMPATIBILITY: only ever added in a networked race (GameManager, net-gated). Single
// player never creates this component.

import { _decorator, Component } from 'cc';
import { StrokeType } from '../core/GameConstants';
import { resolveDiveResult } from '../core/DiveResolver';
import { Swimmer } from './Swimmer';
import { NetInputEvent, NetInputKind, NetInputSide } from '../net/NetRaceInput';

const { ccclass, property } = _decorator;

function strokeType(side: NetInputSide | undefined): StrokeType {
    return side === 1 ? StrokeType.RIGHT : StrokeType.LEFT;
}

@ccclass('RemoteSwimmerController')
export class RemoteSwimmerController extends Component {
    @property(Swimmer) public swimmer: Swimmer = null;
    // The room seat (posNum) whose input this controller replays.
    public pos = -1;
    // Guard so a single dive event can't be applied twice.
    private _dived = false;

    // Apply one logical frame's worth of this member's decoded input events, in order.
    applyEvents(events: NetInputEvent[]): void {
        const swimmer = this.swimmer;
        if (!swimmer || !swimmer.node.active) {
            return;
        }
        for (const event of events) {
            this.applyEvent(swimmer, event);
        }
    }

    private applyEvent(swimmer: Swimmer, event: NetInputEvent): void {
        switch (event.kind) {
            case NetInputKind.Stroke:
                swimmer.handleStroke(strokeType(event.side));
                break;
            case NetInputKind.Kick:
                swimmer.handleKickStroke(strokeType(event.side));
                break;
            case NetInputKind.HeldOn:
                swimmer.handleStrokeHeld(strokeType(event.side), true, 0);
                break;
            case NetInputKind.HeldOff:
                swimmer.handleStrokeHeld(strokeType(event.side), false, 0);
                break;
            case NetInputKind.DiveCharge:
                // Charge start carries no motion; the release event drives the dive.
                break;
            case NetInputKind.DiveRelease:
                this.performDive(swimmer, event.power ?? 0);
                break;
            default:
                break;
        }
    }

    private performDive(swimmer: Swimmer, power: number): void {
        if (this._dived) {
            return;
        }
        this._dived = true;
        swimmer.performDive(resolveDiveResult(Math.max(0, Math.min(1, power))));
    }

    // Reset per-race latch so the same body can be reused across restarts.
    resetRemote(): void {
        this._dived = false;
    }
}

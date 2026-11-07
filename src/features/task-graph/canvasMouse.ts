/**
 * Canvas mouse handling for the task graph view.
 *
 * Complements React Flow's pan/zoom props (`panOnDrag={[1, 2]}`, `zoomOnScroll`):
 *  - right/middle drag pans the canvas (handled by React Flow)
 *  - right click (press + release without dragging) opens context menus on mouse-up,
 *    so a right drag never triggers a menu on platforms firing `contextmenu` on mouse-down
 *  - middle click (no drag) fits the graph into view
 *  - plain wheel zooms (React Flow default); Ctrl+wheel pans the canvas instead
 */
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { Edge, Node } from 'reactflow';

export interface CanvasMouseHandlers {
    getNodes: () => Node[];
    getEdges: () => Edge[];
    fitView: () => void;
    /** Pans the canvas by the given screen pixels. */
    panBy: (dx: number, dy: number) => void;
    onNodeContextMenu: (event: ReactMouseEvent, node: Node) => void;
    onEdgeContextMenu: (event: ReactMouseEvent, edge: Edge) => void;
    onPaneContextMenu: (event: ReactMouseEvent) => void;
}

/** Movement below this distance counts as a click rather than a drag. */
const CLICK_SLOP_PX = 4;
/** Firefox reports wheel deltas in lines (deltaMode 1); normalize to pixels. */
const WHEEL_LINE_PX = 20;

function isWithinCanvas(container: HTMLElement, target: EventTarget | null): boolean {
    return target instanceof Element && container.contains(target) && !!target.closest('.react-flow__renderer');
}

/** Context-menu handlers expect React events; adapt the native mouse-up event accordingly. */
function asReactMouseEvent(event: MouseEvent, currentTarget: HTMLElement): ReactMouseEvent {
    return Object.defineProperties(event, {
        currentTarget: { value: currentTarget, configurable: true },
        nativeEvent: { value: event, configurable: true },
    }) as unknown as ReactMouseEvent;
}

export function registerCanvasMouseHandling(container: HTMLElement, handlers: CanvasMouseHandlers): () => void {
    let press: { button: number; x: number; y: number } | null = null;

    // Suppress native right-button context menus on the canvas; they are re-raised on mouse-up below.
    const onContextMenu = (event: MouseEvent) => {
        if (event.button === 2 && isWithinCanvas(container, event.target)) {
            event.preventDefault();
            event.stopPropagation();
        }
    };

    const onMouseDown = (event: MouseEvent) => {
        if ((event.button === 1 || event.button === 2) && isWithinCanvas(container, event.target)) {
            press = { button: event.button, x: event.clientX, y: event.clientY };
            if (event.button === 1) event.preventDefault(); // avoid middle-click autoscroll
        } else {
            press = null;
        }
    };

    const onMouseUp = (event: MouseEvent) => {
        if (!press || press.button !== event.button) return;
        const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
        const releasedOnCanvas = isWithinCanvas(container, event.target);
        press = null;
        if (moved >= CLICK_SLOP_PX || !releasedOnCanvas) return;
        if (event.button === 1) {
            event.preventDefault();
            handlers.fitView();
            return;
        }
        const menuEvent = asReactMouseEvent(event, container);
        const target = event.target instanceof Element ? event.target : null;
        const nodeElement = target?.closest('.react-flow__node');
        if (nodeElement) {
            const node = handlers.getNodes().find(item => item.id === nodeElement.getAttribute('data-id'));
            if (node) {
                handlers.onNodeContextMenu(menuEvent, node);
                return;
            }
        }
        const edgeElement = target?.closest('.react-flow__edge');
        if (edgeElement) {
            const edge = handlers.getEdges().find(item => item.id === edgeElement.getAttribute('data-id'));
            if (edge) {
                handlers.onEdgeContextMenu(menuEvent, edge);
                return;
            }
        }
        handlers.onPaneContextMenu(menuEvent);
    };

    // Plain wheel events zoom via React Flow; Ctrl+wheel pans instead.
    const onWheelCapture = (event: WheelEvent) => {
        if (!event.ctrlKey || !isWithinCanvas(container, event.target)) return;
        event.preventDefault();
        event.stopPropagation();
        const scale = event.deltaMode === 1 ? WHEEL_LINE_PX : 1;
        // macOS expresses shift+scroll via deltaX, other platforms via deltaY.
        const delta = (event.shiftKey ? event.deltaX || event.deltaY : event.deltaY) * scale;
        if (event.shiftKey) handlers.panBy(-delta, 0);
        else handlers.panBy(0, -delta);
    };

    // Middle-click means "fit view" on the canvas; keep it from opening links in a new window.
    const onAuxClick = (event: MouseEvent) => {
        if (event.button === 1 && isWithinCanvas(container, event.target)) event.preventDefault();
    };

    // The window hosting the canvas (Obsidian may render views in popout windows).
    const ownerWindow = container.ownerDocument.defaultView ?? window;

    container.addEventListener('contextmenu', onContextMenu, true);
    container.addEventListener('mousedown', onMouseDown, true);
    container.addEventListener('auxclick', onAuxClick, true);
    container.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    // The mouseup needs the capture phase: d3-zoom (React Flow's panning) hooks mouseup
    // on the window in the capture phase and ends pan gestures with
    // stopImmediatePropagation(), which would swallow bubble-phase listeners and make
    // every press look like a drag. Listeners on the same target + phase run in
    // registration order; ours is registered once at mount, d3's per press, so ours
    // runs first and can classify the release as a click.
    ownerWindow.addEventListener('mouseup', onMouseUp, true);

    return () => {
        container.removeEventListener('contextmenu', onContextMenu, true);
        container.removeEventListener('mousedown', onMouseDown, true);
        container.removeEventListener('auxclick', onAuxClick, true);
        container.removeEventListener('wheel', onWheelCapture, true);
        ownerWindow.removeEventListener('mouseup', onMouseUp, true);
    };
}

/**
 * Joystick virtual 8-direcciones. Usa Pointer Events (ratón + touch) y
 * bloquea la captura para que el gesto no se escape al canvas.
 */
export class VirtualJoystick {
  constructor(element, knob, { onStart, onEnd } = {}) {
    this.element = element;
    this.knob = knob;
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.active = false;
    this.pointerId = null;
    this.dir = null;
    this.vector = { x: 0, y: 0 };
    this.maxRadius = 0;

    this.element.addEventListener('pointerdown', (e) => this.start(e));
    this.element.addEventListener('pointermove', (e) => this.move(e));
    this.element.addEventListener('pointerup', (e) => this.end(e));
    this.element.addEventListener('pointercancel', (e) => this.end(e));
    this.element.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  start(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.active) return;
    const rect = this.element.getBoundingClientRect();
    this.maxRadius = rect.width * 0.34;
    this.pointerId = e.pointerId;
    this.active = true;
    this.element.setPointerCapture?.(e.pointerId);
    this.element.classList.add('active');
    this.update(e);
    this.onStart?.();
  }

  move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.update(e);
  }

  end(e) {
    if (!this.active || (e.pointerId != null && e.pointerId !== this.pointerId)) return;
    e.preventDefault();
    this.active = false;
    this.pointerId = null;
    this.dir = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.element.classList.remove('active');
    this.onEnd?.();
  }

  update(e) {
    const rect = this.element.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(len, this.maxRadius);
    dx = (dx / len) * clamped;
    dy = (dy / len) * clamped;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    const nx = dx / (this.maxRadius || 1);
    const ny = dy / (this.maxRadius || 1);
    this.vector = { x: nx, y: ny };
    const dead = 0.28;
    if (Math.hypot(nx, ny) < dead) { this.dir = null; return; }
    // Cuantiza a 8 direcciones.
    const angle = Math.atan2(ny, nx);
    const sector = Math.round(angle / (Math.PI / 4));
    this.dir = [Math.round(Math.cos(sector * Math.PI / 4)), Math.round(Math.sin(sector * Math.PI / 4))];
    if (this.dir[0] === 0 && this.dir[1] === 0) this.dir = null;
  }
}

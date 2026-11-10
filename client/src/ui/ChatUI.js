import { CHAT_CHANNELS } from '@almiargo/shared';
import { store } from '../core/store.js';
import { socket } from '../net/socket.js';

const $ = (id) => document.getElementById(id);
const CHANNEL_NAMES = { global: 'Global', local: 'Local', clan: 'Clan', private: 'Privado' };

export class ChatUI {
  constructor() {
    this.panel = $('chatPanel');
    this.channel = 'global';
    this.bind();
  }

  bind() {
    $('chatTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-channel]');
      if (!btn) return;
      this.setChannel(btn.dataset.channel);
    });
    $('chatSend').addEventListener('click', () => this.send());
    $('chatInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.send(); }
    });
    for (const btn of document.querySelectorAll('[data-close="chatPanel"]')) {
      btn.addEventListener('click', () => this.close());
    }
    store.on('chat', () => {
      this.renderIfOpen();
      if (this.panel.classList.contains('hidden')) {
        // El feed del HUD ya recibe el mensaje; nada más que hacer.
      }
    });
  }

  open(channel = null) {
    if (channel) this.setChannel(channel);
    this.panel.classList.remove('hidden');
    this.render();
    this.scrollBottom();
  }

  close() {
    this.panel.classList.add('hidden');
    $('chatInput').blur();
  }

  toggle() {
    if (this.panel.classList.contains('hidden')) this.open(); else this.close();
  }

  setChannel(channel) {
    if (!CHAT_CHANNELS.includes(channel)) return;
    this.channel = channel;
    for (const btn of $('chatTabs').querySelectorAll('button')) {
      btn.classList.toggle('active', btn.dataset.channel === channel);
    }
    $('chatTo').classList.toggle('hidden', channel !== 'private');
    this.render();
  }

  renderIfOpen() {
    if (!this.panel.classList.contains('hidden')) this.render();
  }

  render() {
    const log = $('chatLog');
    log.textContent = '';
    const messages = store.chatLog
      .filter((m) => m.channel === this.channel || (m.channel === 'system' && this.channel !== 'private'))
      .slice(-80);
    if (messages.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chat-line system';
      empty.textContent = `Canal ${CHANNEL_NAMES[this.channel]}. Sé el primero en hablar.`;
      log.appendChild(empty);
    }
    for (const m of messages) {
      const line = document.createElement('div');
      line.className = `chat-line${m.channel === 'system' || m.system ? ' system' : ''}`;
      if (m.channel !== 'system' && !m.system) {
        const who = document.createElement('span');
        who.className = 'who';
        who.style.color = m.color || '#9fd0ff';
        who.textContent = m.channel === 'private' && m.to ? `${m.from} → ${m.to}:` : `${m.from}:`;
        line.appendChild(who);
      }
      const text = document.createElement('span');
      text.textContent = m.text;
      line.appendChild(text);
      log.appendChild(line);
    }
    this.scrollBottom();
  }

  scrollBottom() {
    const log = $('chatLog');
    log.scrollTop = log.scrollHeight;
  }

  send() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    const to = $('chatTo').value.trim();
    if (this.channel === 'private' && !to) {
      $('chatTo').focus();
      return;
    }
    socket.send('chat', { channel: this.channel, text, to: to || undefined });
    input.value = '';
    input.blur();
  }
}

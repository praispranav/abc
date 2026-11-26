// Visuals for each scene type. `cue(name)` is the moment its word is spoken.
const bubble = (id, side, text, extra = '') => `<div id="${id}" class="bubble ${side}">${text}${extra}</div>`;

export const scenes = {
  hook({ cue, show }) {
    show('#m1', cue('msg1'));
    show('#m2', cue('msg2'));
    show('#m3', cue('msg3'));
    show('#lost', cue('lost'), { scale: 1.5 });
    return `<div class="stack">
      <div id="m1" class="notif">हेलो, दाम क्या है?<small>रात 11:02</small></div>
      <div id="m2" class="notif">कोई है? ऑर्डर करना था<small>रात 11:20</small></div>
      <div id="m3" class="notif">ठीक है, कहीं और से ले लेते हैं<small>रात 11:45</small></div>
      <div id="lost" class="stamp">कोई जवाब नहीं ✕</div>
    </div>`;
  },

  agent({ cue, show, anims }) {
    show('#badge', cue('badge'), { scale: 0.3 });
    show('#instant', cue('instant'));
    show('#knows', cue('knows'));
    anims.push(`tl.to("#badge",{scale:1.07,duration:0.5,yoyo:true,repeat:3,ease:"sine.inOut"},${cue('badge') + 0.5});`);
    return `<div class="center">
      <div id="badge" class="orb">AI</div>
      <div id="instant" class="pill big">⚡ तुरंत जवाब, 24×7</div>
      <div id="knows" class="pill">सवाल समझे → सही काम करे</div>
    </div>`;
  },

  chat({ scene, cue, show }) {
    const c = scene.chat;
    const lag = 0.35;
    show('#c-ask', cue('ask'));
    show('#c-card', cue('card') + lag);
    show('#c-order', cue('order'));
    show('#c-pay', cue('pay'));
    show('#c-where', cue('where'));
    show('#c-status', cue('status'));
    return `<div class="phone">
      ${bubble('c-ask', 'them', c.ask)}
      <div id="c-card" class="card"><div class="thumb">🎂</div><div><b>${c.productName}</b><em>${c.productPrice}</em></div></div>
      ${bubble('c-order', 'them', c.order)}
      ${bubble('c-pay', 'us', c.pay, `<u>${c.payLink}</u>`)}
      ${bubble('c-where', 'them', c.where)}
      ${bubble('c-status', 'us', c.status)}
    </div>`;
  },

  channels({ scene, cue, show, anims }) {
    show('#ch-wa', cue('wa'), { x: -80 });
    show('#ch-ig', cue('ig'), { y: -60 });
    show('#ch-tg', cue('tg'), { x: 80 });
    anims.push(`tl.fromTo(".wire",{scaleY:0},{scaleY:1,duration:0.5,ease:"power2.out"},${cue('link')});`);
    show('#hub', cue('source'), { scale: 0.6 });
    return `<div class="channels">
      <div id="ch-wa" class="channel wa"><i>💬</i>WhatsApp<br>Business</div>
      <div id="ch-ig" class="channel ig"><i>📸</i>Instagram</div>
      <div id="ch-tg" class="channel tg"><i>✈️</i>Telegram</div>
    </div>
    <div class="wires"><div class="wire"></div><div class="wire"></div><div class="wire"></div></div>
    <div id="hub" class="hub"><b>एक ही डेटा</b><span>${scene.hubItems}</span></div>`;
  },

  support({ scene, brand, cue, show }) {
    show('#s-name', cue('name'), { scale: 0.6 });
    const t = cue('contacts');
    show('#s-label', t);
    ['s-phone', 's-mail', 's-insta', 's-web'].forEach((id, i) => show(`#${id}`, t + 0.2 + i * 0.25, { x: -60 }));
    return `<div class="center">
      <div id="s-name" class="brand">${brand.name}</div>
      <div id="s-label" class="pill big">🎧 ${scene.supportLabel}</div>
      <div id="s-phone" class="contact"><i>📞</i>${brand.phone}</div>
      <div id="s-mail" class="contact"><i>✉️</i>${brand.email}</div>
      <div id="s-insta" class="contact"><i>📸</i>${brand.instagram}</div>
      <div id="s-web" class="contact"><i>🌐</i>${brand.website}</div>
    </div>`;
  },
};

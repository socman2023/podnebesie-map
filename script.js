
let locations = [];
const mapImage = document.getElementById('main-map');
const overlay = document.getElementById('overlay');
const tooltip = document.getElementById('tooltip');
const titleEl = document.getElementById('tooltip-title');
const imgEl = document.getElementById('tooltip-image');
const descEl = document.getElementById('tooltip-description');
const linksEl = document.getElementById('tooltip-links');
const closeBtn = document.getElementById('close-tooltip');

let canvasScale = 1;

fetch('locations.json')
  .then(res => res.json())
  .then(data => {
    locations = data;
    resizeCanvas();
    drawPoints();
  });

function resizeCanvas() {
  overlay.width = mapImage.clientWidth;
  overlay.height = mapImage.clientHeight;
  canvasScale = mapImage.clientWidth / mapImage.naturalWidth;
}

function drawPoints() {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  locations.forEach(loc => {
    const x = loc.x * canvasScale;
    const y = loc.y * canvasScale;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = getColorByType(loc.type);
    ctx.fill();
    ctx.strokeStyle = '#333';
    ctx.stroke();
  });
}

function getColorByType(type) {
  switch (type) {
    case 'water': return 'skyblue';
    case 'mountain': return 'green';
    case 'state': return 'darkred';
    case 'city': return 'orange';
    case 'region': return 'olive';
    case 'tribe': return 'purple';
    case 'object': return 'brown';
    default: return 'black';
  }
}

overlay.addEventListener('click', function(e) {
  const rect = overlay.getBoundingClientRect();
  const xClick = (e.clientX - rect.left) / canvasScale;
  const yClick = (e.clientY - rect.top) / canvasScale;

  const found = locations.find(loc => {
    const dx = loc.x - xClick;
    const dy = loc.y - yClick;
    return Math.sqrt(dx * dx + dy * dy) < 15;
  });

  if (found) showTooltip(found);
});

function showTooltip(loc) {
  titleEl.textContent = loc.name;
  imgEl.src = 'images/' + loc.image;
  imgEl.alt = loc.name;
  descEl.textContent = loc.description;
  linksEl.innerHTML = '';
  loc.links.forEach(link => {
    const a = document.createElement('a');
    a.textContent = link.text;
    a.href = '#';
    a.onclick = () => {
      const target = locations.find(l => l.id === link.target);
      if (target) showTooltip(target);
      return false;
    };
    linksEl.appendChild(a);
  });
  tooltip.classList.remove('hidden');
}

closeBtn.addEventListener('click', () => {
  tooltip.classList.add('hidden');
});

window.addEventListener('resize', () => {
  resizeCanvas();
  drawPoints();
});

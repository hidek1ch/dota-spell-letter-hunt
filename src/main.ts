import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { CourtyardScene, ArmoryScene } from './exploration/CastleScene';
import './style.css';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 960,
  height: 640,
  backgroundColor: '#10171b',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 4, mouse: { preventDefaultWheel: true } },
  scene: [GameScene, CourtyardScene, ArmoryScene],
  render: { transparent: false, powerPreference: 'high-performance' },
});

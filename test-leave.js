// 测试空房间自动销毁
const io = require('socket.io-client');

function getRooms() {
  return new Promise((resolve) => {
    const socket = io('http://localhost:3000');
    socket.on('connect', () => {
      socket.emit('getRooms');
    });
    socket.on('roomList', (rooms) => {
      socket.disconnect();
      resolve(rooms);
    });
    setTimeout(() => {
      socket.disconnect();
      resolve([]);
    }, 5000);
  });
}

async function run() {
  const socket = io('http://localhost:3000');
  let roomId = null;

  socket.on('connect', () => {
    console.log('已连接');
    socket.emit('createRoom', { zuizi: 10, name: '离开测试' });
  });

  socket.on('joinedRoom', (data) => {
    roomId = data.roomId;
    console.log('创建房间:', roomId);
    socket.emit('addAI');
    socket.emit('addAI');
    socket.emit('addAI');
  });

  socket.on('roomInfo', async (info) => {
    const count = info.players.filter(p => p.name).length;
    if (count === 4) {
      console.log('房间满4人');
      // 断开连接
      setTimeout(async () => {
        console.log('断开连接...');
        socket.disconnect();
        // 等待1秒检查房间列表
        setTimeout(async () => {
          const rooms = await getRooms();
          const found = rooms.find(r => r.roomId === roomId);
          if (found) {
            console.log('❌ 房间未销毁:', found);
            process.exit(1);
          } else {
            console.log('✅ 房间已自动销毁');
            process.exit(0);
          }
        }, 1500);
      }, 500);
    }
  });

  setTimeout(() => {
    console.log('测试超时');
    process.exit(1);
  }, 20000);
}

run();

const {ipcRenderer, clipboard, nativeImage} = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const fileType = require('file-type');
const http = require('http');
const https = require('https');

const mod = (x, n) => (x % n + n) % n;

let canDrag = false,
    dragging = false,
    wasDragging = false,
    imgEl,
    vidEl,
    curEl,
    containerEl,
    vidPaused = false,
    width = 0,
    height = 0,
    zoomStage = 0,
    zoom = 1,
    ignoreResize = [],
    filepath,
    filename,
    localFiles = [],
    fileIndex = 0,
    shift,
    ctrl,
    moveAnimId,
    rotateAnimId,
    mouseStartX,
    mouseStartY,
    mouseX,
    mouseY,
    mouseDown = false,
    mouseRightDown = false,
    panX = 0,
    panY = 0,
    panStartX = 0,
    panStartY = 0,
    angle = 0,
    startAngle = 0,
    isRotated = false,
    border = false,
    pinned = false,
    context,
    curUrl,
    loadedData;


ipcRenderer.on('open', (event, p) => {
    if(p && p.length > 0){
        p.slice(1).forEach((f, i) => {
            if(i === 0){
                loadFile(f);
            } else {
                loadInstance(f);
            }
        });
    }
});

function loadInstance(file){
    ipcRenderer.send('new', file);
}

window.addEventListener('close', e => {
    if(moveAnimId){
        cancelAnimationFrame(moveAnimId);
        moveAnimId = null;
    }
    if(rotateAnimId){
        cancelAnimationFrame(rotateAnimId);
        rotateAnimId = null;
    }
});

function init(){
    console.log('ready');
    
    ipcRenderer.send('resize', 500, 500);
    
    imgEl = document.getElementById('image');
    vidEl = document.getElementById('video');
    
    containerEl = document.getElementById('container');
    
    border = document.body.classList.contains('border');
    
    /*window.addEventListener('mouseover', e => {
        console.log('s');
        document.getElementById('drag').style.display = 'block';
        setTimeout(()=>{
            document.getElementById('drag').style.display = 'none';
        }, 200);
    });
    
    window.addEventListener('mouseleave', e => {
        console.log('l')
        document.getElementById('drag').style.display = 'none';
    });*/
    
    vidEl.addEventListener('play', e => {
        if(vidPaused && (dragging || wasDragging)) {
            wasDragging = false;
            vidEl.pause();
        }
    });
    
    vidEl.addEventListener('pause', e => {
        if(!vidPaused && (dragging || wasDragging)) {
            wasDragging = false;
            vidEl.play();
        }
    });
}
window.onload = init;


window.addEventListener('keydown', e => {
    switch(e.key){
        case 'Shift':
            shift = true;
            break;
        case 'Control':
            ctrl = true;
            break;
        case 'ArrowRight':
            nextFile();
            break;
        case 'ArrowLeft':
            prevFile();
            break;
        case 'ArrowUp':
            relZoom(1);
            break;
        case 'ArrowDown':
            relZoom(-1);
            break;
        case 'b':
            toggleBorder();
            break;
        case 'a':
            togglePinned();
            break;
        case 'Escape':
            window.close();
            break;
        case ' ':
            resetAll();
            break;
        case 'c':
            if(e.ctrlKey){
                copy();
            }
            break;
        case 'v':
            if(e.ctrlKey){
                paste();
            }
            break;
    }
});
window.addEventListener('keyup', e => {
    if(e.key === 'Shift'){
    }
    if(e.key === 'Control'){
        //document.body.classList.remove('border');
    }
    switch(e.key){
        case 'Shift':
            shift = false;
            break;
        case 'Control':
            ctrl = false;
            break;
    }
});

window.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('mousemove', onMouseMove);

function onMouseDown(e) {
    if(e.button === 0){
        mouseDown = true;
    } else if(e.button === 2){
        mouseRightDown = true;
    }
    wasDragging = false;
    vidPaused = vidEl.paused;
    mouseStartX = e.clientX;  
    mouseStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    startAngle = angle;
    
    e.stopPropagation();
    e.preventDefault();
    
    if(!ctrl && !moveAnimId && mouseDown){
        moveAnimId = requestAnimationFrame(moveWindow);
    }
    if(/*!ctrl && */!rotateAnimId && mouseRightDown){
        rotateAnimId = requestAnimationFrame(mouseMoveGlobal);
    }
}

function onMouseUp(e) {
    if(e.button === 0){
        mouseDown = false;
    } else if(e.button === 2){
        mouseRightDown = false;
    }
    if(dragging){
        dragging = false;
        wasDragging = true;
        e.stopPropagation();
        e.preventDefault();
    }
    ipcRenderer.send('windowMoved');
    cancelAnimationFrame(moveAnimId);
    moveAnimId = null;
    cancelAnimationFrame(rotateAnimId);
    rotateAnimId = null;
}

function moveWindow() {
    if(!ctrl){
        ipcRenderer.send('windowMoving', mouseStartX, mouseStartY, filename);
        moveAnimId = requestAnimationFrame(moveWindow);
    }
}

function onMouseMove(e) {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if(mouseDown && (mouseX !== mouseStartX || mouseY !== mouseStartY)){
        dragging = true;
    }
    if(!ctrl){
        return;
    }
    if(ctrl && mouseDown){
        pan(mouseX - mouseStartX, mouseY - mouseStartY);
    }
}

function mouseMoveGlobal(){
    let {x, y} = ipcRenderer.sendSync('getCursorPosition');
    mouseX = x;
    mouseY = y;
    if(mouseRightDown){
        rotateCoords(mouseX, mouseY, mouseStartX, mouseStartY);
    }
    rotateAnimId = requestAnimationFrame(mouseMoveGlobal);
}

function copy(){
    if(curEl === imgEl){
        if(loadedData){
            clipboard.writeImage(nativeImage.createFromDataURL(loadedData))
        } else if(context === 'url') {
            getData(curUrl, data => {
                loadedData = data;
                clipboard.writeImage(nativeImage.createFromDataURL(loadedData));
            });
        } else {
            //?
        }
    }
    //TODO: video copy?
}

function paste(){
    let image = clipboard.readImage();
    if(image.isEmpty()){
        loadUrl(clipboard.readText());
    } else {
        loadData(image.toDataURL());
    }
}

function pan(x, y){
    panX = panStartX + x;
    panY = panStartY + y;
    containerEl.style.left = `${panX}px`;
    containerEl.style.top = `${panY}px`;
}

function rotateCoords(x, y, origX, origY){
    let bounds = curEl.getBoundingClientRect(),
        centerX = bounds.x + bounds.width / 2,
        centerY = bounds.y + bounds.height / 2;
    let origAngle = mod((180 / Math.PI) * Math.atan2(origY - centerY, origX - centerX), 360),
        curAngle = mod((180 / Math.PI) * Math.atan2(y - centerY, x - centerX), 360);
    rotate(curAngle - origAngle);
}

function rotate(a){
    angle = mod((startAngle + a), 360);
    containerEl.style.transform = `rotate(${angle}deg)`;
    if(!isRotated){
        isRotated = true;
        //resizeMax();
    }
}

function toggleBorder(){
    border = !border;
    if(border){
        document.body.classList.add('border');
    } else {
        document.body.classList.remove('border');
    }
}

function togglePinned(){
    ipcRenderer.send('setAlwaysOnTop', pinned = !pinned);
}


function loadFile(pathname){
    if(pathname === '.'){
        return;
    }
    fs.readFile(pathname, (err, buffer) => {
        if(err){
            console.error(err);
        }
        loadData(buffer, fileType(buffer).mime);
    });
    
    context = 'file';
    curUrl = null;
    loadDirectory(pathname);
}

function loadUrl(url){
    (url.startsWith('https') ? https : http).get(url, res => {
        res.once('readable', () => {
            let chunk = res.read(196); //mp2t magic number extends to 196, ignoring that the next highest is 58 (ASF) then like 36
            res.destroy();
            
            context = 'url';
            loadedData = null;
            curUrl = url;
            //TODO: maybe abstract this process
            let mime = fileType(chunk).mime;
            curEl && curEl.removeAttribute('src');
            if(mime[0] === 'i'){
                curEl = imgEl;
                curEl.setAttribute('src', url);
                curEl.onload = loadDone;
            } else if(mime[0] === 'v'){
                curEl = vidEl;
                curEl.setAttribute('src', url);
                curEl.onloadedmetadata = loadDone;
            }
        });
    });
}

function loadFromUrl(url){
    (url.startsWith('https') ? https : http).get(url, res => {
        res.once('readable', () => {
            let chunk = res.read();
            res.destroy();
            
            context = 'url';
            loadData(chunk, fileType(chunk).mime);
        });
    });
}

function getData(url, cb){
    (url.startsWith('https') ? https : http).get(url, res => {
        let buffer;
        res.on('readable', () => {
            if(buffer){
                let next = res.read();
                if(next){
                    buffer = Buffer.concat([buffer, next]);
                }
            } else {
                buffer = res.read();
            }
            
        });
        res.on('end', () => {
            res.destroy();
            cb(`data:${fileType(buffer).mime};base64,${buffer.toString('base64')}`);
        })
    });
}

function loadData(data, mime){
    if(mime){
        data = `data:${mime};base64,${data.toString('base64')}`;
    } else {
        mime = data.match(/^data:(.+);/)[1];
    }
    loadedData = data;
    curEl && curEl.removeAttribute('src');
    if(mime[0] === 'i'){
        curEl = imgEl;
        curEl.setAttribute('src', data);
        curEl.onload = loadDone;
    } else if(mime[0] === 'v'){
        curEl = vidEl;
        curEl.setAttribute('src', data);
        vidPaused = false;
        curEl.onloadedmetadata = loadDone;
    } else {
        
    }
}

function loadDone(){
    resetAll();
}

function resetAll(){
    if(curEl === imgEl){
        width = curEl.naturalWidth;
        height = curEl.naturalHeight;
    } else if(curEl === vidEl) {
        width = curEl.videoWidth;
        height = curEl.videoHeight;
    }
    startAngle = 0;
    rotate(0);
    isRotated = false;
    zoom = 1;
    zoomStage = 0;
    relZoom(0);
    ipcRenderer.send('resize', width, height, true);
}

window.addEventListener('dragover', drag);
window.addEventListener('drop', drop);

function drag(e){
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer.dropEffect = 'link';
}

function drop(e){
    e.preventDefault();
    e.stopPropagation();
    
    let files = Array.from(e.dataTransfer.files);
    if(!files || files.length === 0){
        let items = Array.from(e.dataTransfer.items)
        
        //NOTE: this probably doesn't work. need to look deeper into how to get this data
        /*if(arr.some(v => /^image\/.+/.test(v.type))){
            arr.filter(v => /^image\/.+/.test(v.type))[0].getAsString(loadData);
        } else {
        }*/
        if(items.some(v => v.type === 'text/uri-list')){
            items.filter(v => v.type === 'text/uri-list')[0].getAsString(loadUrl);
        }
    } else {
        files.forEach((file, i) =>{
            if(!file || !file.path){
                return console.warn('no path');
            }
            if(i === 0){
                loadFile(file.path);
            } else {
                loadInstance(file.path);
            }
        })
    }
}

function loadDirectory(dir, name){
    fs.lstat(dir, (err, stats) => {
        if(err){
            return console.error(err);
        }
        if(!stats.isDirectory()){
            filename = name = path.basename(dir);
            filepath = dir = path.resolve(dir, '..');
        }
        fs.readdir(dir, (err, list) => {
            if(err){
                return console.error(err);
            }
            localFiles = list;
            fileIndex = list.indexOf(name);
        });
    })
}

function nextFile(){
    if(context === 'file'){
        fileIndex = mod((fileIndex + 1), localFiles.length);
        loadFile(path.resolve(filepath, localFiles[fileIndex]));
    }
}

function prevFile(){
    if(context === 'file'){
        fileIndex = mod((fileIndex - 1), localFiles.length);
        loadFile(path.resolve(filepath, localFiles[fileIndex]));
    }
}

window.addEventListener('mousewheel', e => {
    relZoom(-e.deltaY);
});

function relZoom(dir){
    if(!curEl){
        return;
    }
    if(zoom === null){
        let scale = Math.min(curEl.clientWidth, curEl.clientHeight) / Math.min(width, height);
        if(scale >= 1){
            zoomStage = Math.round(scale) - 1;
        } else {
            zoomStage = 1 - Math.round(1/scale);
        }
    }
    if(shift){
        if(dir < 0){
            zoomStage -= 8;
        } else if(dir > 0) {
            zoomStage += 8;
        }
    } else {
        if(dir < 0){
            zoomStage--;
        } else if(dir > 0) {
            zoomStage++;
        }
    }
    
    updateZoom();
}

function updateZoom(){
    if(!curEl){
        return;
    }
    if(zoomStage >= 0){
        zoom = zoomStage + 1;
    } else {
        //zoomStage = Math.max(-10, zoomStage);
        zoom = 1 / (Math.abs(zoomStage) + 1);
    }
    if(zoom > 1){
        curEl.classList.add('pixel');
    } else {
        curEl.classList.remove('pixel');
    }
    
    let newWidth = Math.min(screen.availWidth, width * zoom);
    let newHeight = Math.min(screen.availHeight, height * zoom);
    if(newWidth >= process.env.MIN_WIDTH || newHeight >= process.env.MIN_HEIGHT){
        curEl.classList.add('contain');
    } else {
        curEl.classList.remove('contain');
    }
    
    curEl.setAttribute('width', width * zoom);
    if(ctrl || width * zoom > newWidth || height * zoom > newHeight){
        curEl.classList.remove('contain');
    }
    if(!ctrl){
        ignoreResize.push(true);
        ipcRenderer.send('resize', Math.round(newWidth), Math.round(newHeight), true);
        pan(panX = panStartX = 0, panY = panStartY = 0);
    }
}

function resizeMax(){
    curEl.classList.remove('contain');
    let {width, height} = curEl.getBoundingClientRect();
    
    let a = Math.atan((curEl.clientHeight) / (curEl.clientWidth));
    
    width = (curEl.clientWidth)*Math.abs(Math.cos(a)) + (curEl.clientHeight)*Math.abs(Math.sin(a));
    height = width;
    
    width = Math.min(screen.availWidth, width);
    height = Math.min(screen.availHeight, height);
    
    ipcRenderer.send('resize', Math.round(width), Math.round(height), true);
}

window.addEventListener('resize', onResize);

function onResize(e){
    if(ignoreResize.length > 0){
        ignoreResize.pop();
        return;
    }
    zoom = null;
    curEl && curEl.classList.remove('pixel');
}

// Receives a resized, already watermarked bitmap. No network or persistent data.
self.onmessage = async ({data:{bitmap,qualities,target}}) => {
  try {
    const canvas = new OffscreenCanvas(bitmap.width,bitmap.height);
    const ctx = canvas.getContext('2d',{alpha:false});
    if (!ctx) throw Error();
    ctx.drawImage(bitmap,0,0);
    bitmap.close();
    let result;
    for (const quality of qualities) {
      const blob = await canvas.convertToBlob({type:'image/jpeg',quality});
      if (blob.size && (!result || blob.size < result.size)) result = blob;
      if (result && result.size <= target) break;
    }
    self.postMessage(result);
  } catch { self.postMessage(null); }
};

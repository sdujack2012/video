import numpy as np
import sys, json

from moviepy.editor import *
from moviepy.video.tools.segmenting import findObjects
from moviepy.config import change_settings
# WE CREATE THE TEXT THAT IS GOING TO MOVE, WE CENTER IT.
change_settings({"IMAGEMAGICK_BINARY": r"C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe"})


if sys.argv[1] is None:
    sys.exit(0)

with open(sys.argv[1], "r", encoding="utf-8") as file:
    textInfo = json.load(file)
    video_clip = VideoFileClip(filename=textInfo["videoPath"])

    screensize = video_clip.size
    txtClip = TextClip(textInfo["text"],color=textInfo["fontColor"], font=textInfo["font"],
                 size=(screensize[0] - 100, screensize[1]), method='caption', fontsize=textInfo["fontSize"], kerning=-1)
    cvc = CompositeVideoClip( [txtClip.set_pos('center')], size=screensize)
    # THE NEXT FOUR FUNCTIONS DEFINE FOUR WAYS OF MOVING THE LETTERS

    duration = textInfo["duration"]
      # helper function
    rotMatrix = lambda a: np.array( [[np.cos(a),np.sin(a)], 
                                    [-np.sin(a),np.cos(a)]] )
    def vortex(screenpos, i, nletters):  # noqa D103
        d = lambda t: max(0, 3-3/(duration/2)*t)  # damping
        a = i * np.pi / nletters  # angle of the movement
        v = rotMatrix(a).dot([-1, 0])
        if i % 2:
            v[1] = -v[1]
        return lambda t: screenpos + 400 * d(t) * rotMatrix(0.5 * d(t) * a).dot(v)

    def arrive(screenpos,i,nletters):
        v = np.array([-1,0])
        d = lambda t : max(0, (duration/4 - t))
        return lambda t: screenpos-200*v*d(t)
        
    def vortexout(screenpos,i,nletters):
        d = lambda t : max(0,3/((duration-2)/4)*(t-2)) #damping
        a = i*np.pi/ nletters # angle of the movement
        v = rotMatrix(a).dot([-1,0])
        if i%2 : v[1] = -v[1]
        return lambda t: screenpos+200*d(t)*rotMatrix(-0.2*d(t)*a).dot(v)

    # WE USE THE PLUGIN findObjects TO LOCATE AND SEPARATE EACH LETTER

    letters = findObjects(cvc, rem_thr=0) # a list of ImageClips

    # WE ANIMATE THE LETTERS

    def moveLetters(letters, funcpos):
        return [ letter.set_pos(funcpos(letter.screenpos,i,len(letters)))
                for i,letter in enumerate(letters)]

    clips = [ CompositeVideoClip( moveLetters(letters,funcpos),
                                size = screensize).subclip(0, duration/2)
            for funcpos in [vortex, vortexout] ]

    # WE CONCATENATE EVERYTHING AND WRITE TO A FILE

    final_clip = concatenate_videoclips(clips)
    final_clip = CompositeVideoClip([video_clip, final_clip], size=screensize)
    final_clip.write_videofile(textInfo["outputFilePath"], codec="libx264", threads = 12, fps=textInfo["framerate"])
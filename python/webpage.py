import streamlit as st
from main import create_frame
import io

st.title("Mandelbrot Explorer")

st.markdown("""
This is an interactive explorer for the [mandelbrot set](https://en.wikipedia.org/wiki/Mandelbrot_set).

You can use the buttons below to find a region of interest.

It is recommended to use low resolution while exploring. Once you found an image that you really like,
turn up the resolution and click the download button to save the image as png.

""")


if 'w' not in st.session_state:
    st.session_state['w'] = 1.92 * 2.0000000000000
if 'h' not in st.session_state:
    st.session_state['h'] = 1.08 * 2.0000000000000
if 'center_x' not in st.session_state:
    st.session_state['center_x'] = -0.7450450892059
if 'center_y' not in st.session_state:
    st.session_state['center_y'] = 0.1126120218022
if 'resolution' not in st.session_state:
    st.session_state['resolution'] = "240p"



resolutions={
    "240p": (427, 240),
    "480p": (854, 480),
    "1080p": (1920, 1080),
    "4K": (3840, 2160),
}

c1, c2, c3, c4, c5, c6 = st.columns(6)
with c1:
    b1=st.button(label="⊕")
with c2:
    b2=st.button(label="⊖")
with c3:
    b3=st.button(label="⇦")
with c4:
    b4=st.button(label="⇨")
with c5:
    b5=st.button(label="⇧")
with c6:
    b6=st.button(label="⇩")

nw,nh = resolutions[st.session_state.resolution]
frame = create_frame(
    center=(st.session_state.center_x, st.session_state.center_y),
            w=st.session_state.w,
            h=st.session_state.h,
            nw=nw,
            nh=nh)
img_frame = st.image(frame, use_column_width=True)



c11, c22 = st.columns(2)
with c11:
    resolution_selector = st.selectbox(
         'Select resolution',
         ('240p', '480p', '1080p', '4K'))
with c22:
    st.text("Click here to download")
    nw,nh = resolutions[st.session_state.resolution]
    frame = create_frame(
        center=(st.session_state.center_x, st.session_state.center_y),
        w=st.session_state.w,
        h=st.session_state.h,
        nw=nw,
        nh=nh)
    imgByteArr = io.BytesIO()
    frame.save(imgByteArr, "png")
    download_button = st.download_button(
        label="Download image",
        data=imgByteArr.getvalue(),
        file_name=f"mandelbrot_{st.session_state.resolution}.png",
        mime="image/png")


st.markdown("""

---
Developed by [Lukas Scheucher](https://www.linkedin.com/in/scheuclu/),
Code at [Github](https://github.com/scheuclu/mandelbrot), Hosted via [Streamlit](https://streamlit.io/)
""")

def redraw_frame():
    with st.spinner('Rendering image...'):
        nw,nh = resolutions[st.session_state.resolution]
        frame = create_frame(
            center=(st.session_state.center_x, st.session_state.center_y),
            w=st.session_state.w,
            h=st.session_state.h,
            nw=nw,
            nh=nh)
        img_frame.image(frame, use_column_width=True)

if b1:
    st.session_state.w*=0.5
    st.session_state.h*=0.5
    redraw_frame()
if b2:
    st.session_state.w*=1.5
    st.session_state.h*=1.5
    redraw_frame()
if b3:
    st.session_state.center_x=st.session_state.center_x-st.session_state.w/3
    redraw_frame()
if b4:
    st.session_state.center_x=st.session_state.center_x+st.session_state.w/3
    redraw_frame()
if b5:
    st.session_state.center_y=st.session_state.center_y-st.session_state.h/3
    redraw_frame()
if b6:
    st.session_state.center_y=st.session_state.center_y+st.session_state.h/3
    redraw_frame()
if resolution_selector:
    st.session_state.resolution=resolution_selector
    redraw_frame()




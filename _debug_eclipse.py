import numpy as np
from constants import INDEX, BODIES, KM_PER_AU, J2000_JD
from simulation import SolarSystem
from eclipse import _angular_separation

sys = SolarSystem(use_cache=True)
# Integrate 1.5 years, record Sun-Moon separation at every step.
from integrator import VerletIntegrator
integ = VerletIntegrator(sys.pos0, sys.vel0, sys.gm, 0.5)
iS, iE, iM = INDEX["Sun"], INDEX["Earth"], INDEX["Moon"]
recs=[]
def cb(it,i):
    s=it.pos[iS]-it.pos[iE]; m=it.pos[iM]-it.pos[iE]
    recs.append((it.time, np.degrees(_angular_separation(s,m))))
integ.run(int(1.5*365.25/0.5), cb)
# find local minima
mins=[]
for k in range(1,len(recs)-1):
    if recs[k][1]<recs[k-1][1] and recs[k][1]<recs[k+1][1]:
        mins.append(recs[k])
print("new-moon minima (days since J2000, Sun-Moon sep deg):")
for t,sep in mins:
    jd=J2000_JD+t
    print(f"  t={t:8.2f}  JD={jd:.1f}  sep={sep:.3f} deg")
